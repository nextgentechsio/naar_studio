import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { StoredUser } from "@/lib/auth/users";
import type { PublicProject } from "@/lib/auth/roles";
import { audioSeconds, ElevenLabsError, elevenLabsConfigured, runElevenLabs } from "@/lib/elevenlabs/client";
import { elevenLabsCostUsd, elevenLabsSchema, findElevenLabsModel } from "@/lib/elevenlabs/models";
import { finishLocalRun, getGeneration, recordGeneration } from "@/lib/generations";
import { findActiveProjectByName } from "@/lib/projects";

// --------------------------------------------------
// START AN ELEVENLABS RUN
//
// Shared by the website (/api/elevenlabs/generate) and
// the Naar Studio API (/api/v1/generations). The run is
// recorded first, so it can never go untracked; the call
// to ElevenLabs, the saved audio and the cost happen after
// the response (finishLocalRun), and the caller polls as
// for the other platforms. Must be called from a request
// (it schedules work with `after`).
// --------------------------------------------------

const MAX_TEXT = 10_000;
// How often a run checks whether it was canceled
const CANCEL_CHECK_MS = 2000;

export type StartElevenLabsInput = {
  user: StoredUser;
  project: unknown;
  model: unknown;
  inputs: unknown;
  apiKey?: { id: string; name: string } | null;
};

export type StartElevenLabsResult =
  | {
      ok: true;
      predictionId: string;
      project: PublicProject;
      model: string;
      inputs: Record<string, unknown>;
      // Exact for text to speech; for the rest, from the
      // requested length (the cost is measured after)
      costUsd: number | null;
    }
  | { ok: false; status: number; error: string };

const fail = (error: string, status = 400): StartElevenLabsResult => ({ ok: false, status, error });

export async function startElevenLabsGeneration(options: StartElevenLabsInput): Promise<StartElevenLabsResult> {
  const { project, model, inputs } = options;

  if (!elevenLabsConfigured()) {
    return fail("ElevenLabs is not configured on the server", 500);
  }

  if (typeof project !== "string" || !project.trim()) return fail("Project is required");

  const item = typeof model === "string" ? findElevenLabsModel(model) : null;
  if (!item) return fail("Unknown ElevenLabs model");

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return fail("Inputs are required");

  // Only this model's own settings (the form's keys)
  const known = new Set(Object.keys(elevenLabsSchema(item, [])));
  const input = Object.fromEntries(Object.entries(inputs as Record<string, unknown>).filter(([key]) => known.has(key)));

  const text = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (item.tool !== "voice-changer" && !text) {
    return fail(item.tool === "tts" ? "Add the text to speak" : "Add a description");
  }
  if (text.length > MAX_TEXT) return fail(`Text must be ${MAX_TEXT.toLocaleString()} characters or fewer`);
  if (item.tool === "voice-changer" && !input.audio_url) return fail("Add a recording to re-voice");
  if ((item.tool === "tts" || item.tool === "voice-changer") && !input.voice_id) return fail("Choose a voice");

  const projectRecord = await findActiveProjectByName(project);
  if (!projectRecord) return fail("Unknown or archived project");

  const id = randomUUID();
  await recordGeneration({
    predictionId: id,
    user: options.user,
    project: projectRecord,
    model: item.id,
    version: "",
    inputs: input,
    status: "processing",
    provider: "elevenlabs",
    apiKey: options.apiKey ?? null,
  });

  after(async () => {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;

    // Canceled (lib/generation-cancel.ts): stop the request
    // instead of waiting it out
    const stop = new AbortController();
    const watch = setInterval(() => {
      getGeneration(id)
        .then((current) => current?.status === "canceled" && stop.abort())
        .catch(() => {});
    }, CANCEL_CHECK_MS);

    try {
      const audio = await runElevenLabs(item.id, input, stop.signal);
      await finishLocalRun(id, {
        ok: true,
        ...audio,
        // Text to speech: by the text; the rest: by the
        // audio made
        costUsd: elevenLabsCostUsd(item.id, input, item.tool === "tts" ? null : audioSeconds(audio.bytes.length)),
        seconds: seconds(),
      });
    } catch (error) {
      // Canceled: the record already says so
      if (stop.signal.aborted) return;
      console.error("ElevenLabs run failed:", id, error instanceof Error ? error.message : "unknown error");
      await finishLocalRun(id, {
        ok: false,
        error: error instanceof ElevenLabsError ? error.message : "ElevenLabs couldn't make this. Please try again.",
        seconds: seconds(),
      }).catch((finishError) => console.error("Finish ElevenLabs run failed:", id, finishError));
    } finally {
      clearInterval(watch);
    }
  });

  return {
    ok: true,
    predictionId: id,
    project: projectRecord,
    model: item.id,
    inputs: input,
    costUsd: elevenLabsCostUsd(item.id, input),
  };
}

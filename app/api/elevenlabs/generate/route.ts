import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  audioSeconds,
  ElevenLabsError,
  elevenLabsConfigured,
  runElevenLabs,
} from "@/lib/elevenlabs/client";
import { elevenLabsCostUsd, elevenLabsSchema, findElevenLabsModel } from "@/lib/elevenlabs/models";
import { finishLocalRun, recordGeneration } from "@/lib/generations";
import { findActiveProjectByName } from "@/lib/projects";

export const runtime = "nodejs";
// The run happens after the response (see below); long
// enough for a 5-minute song
export const maxDuration = 300;

// --------------------------------------------------
// START AN ELEVENLABS RUN
//
// Same contract as /api/generate ({ project, model,
// inputs } → { prediction, tracking, costUsd }). The run
// is recorded first, so it can never go untracked; the
// call to ElevenLabs, the saved audio and the cost happen
// after the response (finishLocalRun), and the page polls
// /api/predictions/[id] as for the other platforms.
// --------------------------------------------------

const MAX_TEXT = 10_000;

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!elevenLabsConfigured()) {
    return badRequest("ElevenLabs is not configured on the server", 500);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { project, model, inputs } = body ?? {};

  if (typeof project !== "string" || !project.trim()) return badRequest("Project is required");

  const item = typeof model === "string" ? findElevenLabsModel(model) : null;
  if (!item) return badRequest("Unknown ElevenLabs model");

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return badRequest("Inputs are required");

  // Only this model's own settings (the form's keys)
  const known = new Set(Object.keys(elevenLabsSchema(item, [])));
  const input = Object.fromEntries(
    Object.entries(inputs as Record<string, unknown>).filter(([key]) => known.has(key))
  );

  const text = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (item.tool !== "voice-changer" && !text) {
    return badRequest(item.tool === "tts" ? "Add the text to speak" : "Add a description");
  }
  if (text.length > MAX_TEXT) return badRequest(`Text must be ${MAX_TEXT.toLocaleString()} characters or fewer`);
  if (item.tool === "voice-changer" && !input.audio_url) return badRequest("Add a recording to re-voice");
  if ((item.tool === "tts" || item.tool === "voice-changer") && !input.voice_id) return badRequest("Choose a voice");

  try {
    const projectRecord = await findActiveProjectByName(project);
    if (!projectRecord) return badRequest("Unknown or archived project");

    const id = randomUUID();
    await recordGeneration({
      predictionId: id,
      user: auth.user,
      project: projectRecord,
      model: item.id,
      version: "",
      inputs: input,
      status: "processing",
      provider: "elevenlabs",
    });

    after(async () => {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 100) / 10;

      try {
        const audio = await runElevenLabs(item.id, input);
        await finishLocalRun(id, {
          ok: true,
          ...audio,
          // Text to speech: by the text; the rest: by the
          // audio made
          costUsd: elevenLabsCostUsd(item.id, input, item.tool === "tts" ? null : audioSeconds(audio.bytes.length)),
          seconds: seconds(),
        });
      } catch (error) {
        console.error("ElevenLabs run failed:", id, error instanceof Error ? error.message : "unknown error");
        await finishLocalRun(id, {
          ok: false,
          error: error instanceof ElevenLabsError ? error.message : "ElevenLabs couldn't make this. Please try again.",
          seconds: seconds(),
        }).catch((finishError) => console.error("Finish ElevenLabs run failed:", id, finishError));
      }
    });

    return NextResponse.json({
      success: true,
      tracking: { predictionId: id, project: projectRecord.name, projectId: projectRecord.id, model: item.id, status: "processing" },
      prediction: { id, status: "processing" },
      // Exact for text to speech; for the rest, from the
      // requested length (the cost is measured after)
      costUsd: elevenLabsCostUsd(item.id, input),
    });
  } catch (error) {
    console.error("ElevenLabs generate error:", error instanceof Error ? error.message : error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

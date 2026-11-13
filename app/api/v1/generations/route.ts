import { NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { listKeyGenerations, toApiGeneration } from "@/lib/api-keys/generations";
import { API_LIVE_PLATFORMS, type ApiKeyPlatform } from "@/lib/api-keys/shared";
import { checkCapAlerts, checkRunAllowed } from "@/lib/api-keys/spend";
import { projectsCollection } from "@/lib/db/mongodb";
import { getGeneration } from "@/lib/generations";
import { startElevenLabsGeneration } from "@/lib/elevenlabs/start";
import { startHiggsfieldGeneration } from "@/lib/higgsfield/start";
import { startReplicateGeneration } from "@/lib/replicate/start";

export const runtime = "nodejs";
// An ElevenLabs run happens after the response (lib/
// elevenlabs/start.ts); long enough for a 5-minute song
export const maxDuration = 300;

// --------------------------------------------------
// NAAR STUDIO API: GENERATIONS
//
// POST { platform?, model, input, project? } starts a run
// (platform: replicate by default, higgsfield or
// elevenlabs) as the key's account, billed to one of the
// key's projects (the default when none is named).
// Refused at the key's monthly cap or its runs-at-once
// limit.
// GET lists the key's runs, newest first.
// --------------------------------------------------

const MAX_BODY_BYTES = 200_000;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return apiError("body_too_large", "The request body is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text || "null");
  } catch {
    return apiError("invalid_json", "The request body must be JSON.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError("invalid_request", "Send a JSON object with model and input.", 400);
  }

  const { platform: rawPlatform = "replicate", model, input, project: rawProject } = body as Record<string, unknown>;
  const platform = rawPlatform as ApiKeyPlatform;
  if (typeof rawPlatform !== "string" || !API_LIVE_PLATFORMS.includes(platform)) {
    return apiError("invalid_request", `platform must be one of: ${API_LIVE_PLATFORMS.join(", ")}.`, 400);
  }

  const guard = await requireApiKey(request, { platform });
  if (guard.response) return guard.response;
  const { key, user } = guard.caller;

  // The project: the key's default, or one it may bill,
  // by id or name
  const projects = await (await projectsCollection())
    .find({ _id: { $in: key.projectIds } }, { projection: { name: 1, status: 1 } })
    .toArray();
  const wanted = typeof rawProject === "string" ? rawProject.trim().toLowerCase() : "";
  const project = wanted
    ? projects.find((item) => item._id === rawProject || item.name.toLowerCase() === wanted)
    : projects.find((item) => item._id === key.projectIds[0]);
  if (!project) {
    return apiError("project_not_allowed", wanted ? "This key can't bill that project." : "This key has no project to bill.", 403);
  }
  if (project.status !== "active") return apiError("project_archived", `Project "${project.name}" is archived.`, 409);

  try {
    const allowed = await checkRunAllowed(key);
    if (!allowed.allowed) {
      if (allowed.reason === "cap") {
        void checkCapAlerts(key, allowed.spend).catch(() => undefined);
        return apiError(
          "spend_cap_reached",
          `This key's monthly cap of $${key.monthlyCapUsd!.toFixed(2)} is reached ($${allowed.spend.amountUsd.toFixed(2)} spent` +
            (allowed.spend.inFlightUsd ? `, $${allowed.spend.inFlightUsd.toFixed(2)} in flight` : "") +
            `). Raise the cap or wait for next month.`,
          402
        );
      }
      return apiError(
        "too_many_runs",
        `This key already has ${allowed.spend.inFlight} run${allowed.spend.inFlight === 1 ? "" : "s"} in flight (its limit). Wait for one to finish.`,
        429,
        { "Retry-After": "5" }
      );
    }

    const start = { user, project: project.name, model, inputs: input, apiKey: { id: key._id.toHexString(), name: key.name } };
    const result =
      platform === "higgsfield"
        ? await startHiggsfieldGeneration(start)
        : platform === "elevenlabs"
          ? await startElevenLabsGeneration(start)
          : await startReplicateGeneration(start);

    if (!result.ok) {
      const code =
        result.status === 422
          ? "invalid_input"
          : result.status === 402
            ? "provider_credits"
            : result.status >= 500
              ? "provider_error"
              : "invalid_request";
      return apiError(code, result.error, result.status);
    }

    const doc = await getGeneration(result.predictionId);
    const origin = new URL(request.url).origin;
    return NextResponse.json(
      doc ? toApiGeneration(doc, origin) : { id: result.predictionId, object: "generation", status: "starting" },
      { status: 202 }
    );
  } catch (error) {
    console.error("API start generation error:", error);
    return apiError("server_error", "Couldn't start the generation. Try again.", 500);
  }
}

export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  if (status && !["starting", "processing", "succeeded", "failed", "canceled"].includes(status)) {
    return apiError("invalid_request", "status must be starting, processing, succeeded, failed or canceled.", 400);
  }

  try {
    const { docs, nextCursor } = await listKeyGenerations(guard.caller.key, {
      limit: Number(params.get("limit")) || 20,
      cursor: params.get("cursor"),
      status,
    });
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      object: "list",
      data: docs.map((doc) => toApiGeneration(doc, origin)),
      nextCursor,
    });
  } catch (error) {
    console.error("API list generations error:", error);
    return apiError("server_error", "Couldn't list generations.", 500);
  }
}

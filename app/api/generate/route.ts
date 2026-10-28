import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { recordGeneration } from "@/lib/generations";
import { findActiveProjectByName } from "@/lib/projects";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  replicateHeaders,
} from "@/lib/replicate/api";
import { calculateReplicateCost } from "@/lib/replicate/cost";
import { inputSchemaFromModel, shapeInputs } from "@/lib/replicate/inputs";
import { isValidModelId, modelPath } from "@/lib/replicate/model";

export const runtime = "nodejs";

// --------------------------------------------------
// START A GENERATION
//
// Validates the request, starts a Replicate prediction
// and records it in MongoDB (status, cost and expense
// are filled in later by /api/predictions/[id] and the
// history reconcile). Spend is always attributed to the
// signed-in account and an active project.
// --------------------------------------------------

const RECORD_ATTEMPTS = 3;
const MAX_INPUT_BYTES = 100_000;

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Invalid request body");
  }

  const { project, model, inputs } = body as Record<string, unknown>;

  // ---------- Validation ----------

  if (typeof project !== "string" || !project.trim()) {
    return badRequest("Project is required");
  }

  if (typeof model !== "string" || !model) {
    return badRequest("Model is required");
  }

  if (!isValidModelId(model)) {
    return badRequest("Invalid model ID");
  }


  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return badRequest("Model inputs are required");
  }

  if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) {
    return badRequest("Model inputs are too large");
  }

  const headers = replicateHeaders({ "Content-Type": "application/json" });

  if (!headers) {
    console.error("REPLICATE_API_TOKEN is missing");
    return badRequest("Generation is not configured on the server", 500);
  }

  try {
    // Only active projects from the database can be billed
    const projectRecord = await findActiveProjectByName(project);

    if (!projectRecord) {
      return badRequest("Unknown or archived project");
    }

    // ---------- Model (for its version and input schema) ----------

    const modelResponse = await fetch(
      replicateApiUrl(`models/${modelPath(model)}`),
      { headers, cache: "no-store" }
    );
    const modelData = await readReplicateJson(modelResponse);

    if (!modelResponse.ok) {
      return badRequest(
        replicateErrorMessage(modelData, "Failed to fetch the selected model"),
        modelResponse.status === 404 ? 404 : 502
      );
    }

    const latestVersion = modelData.latest_version as
      | { id?: string }
      | undefined;

    if (!latestVersion?.id) {
      return badRequest("Selected model does not have a runnable version.");
    }

    const shapedInputs = shapeInputs(
      inputs as Record<string, unknown>,
      inputSchemaFromModel(modelData)
    );

    // ---------- Start the prediction ----------

    const predictionResponse = await fetch(
      replicateApiUrl(`models/${modelPath(model)}/predictions`),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ input: shapedInputs }),
      }
    );
    const prediction = await readReplicateJson(predictionResponse);

    if (!predictionResponse.ok) {
      // 4xx from Replicate is about the inputs: show it
      return badRequest(
        replicateErrorMessage(prediction, "Replicate rejected the request"),
        predictionResponse.status >= 500 ? 502 : 422
      );
    }

    const predictionId = typeof prediction.id === "string" ? prediction.id : "";

    if (!predictionId) {
      console.error("Replicate returned no prediction id", prediction);
      return badRequest("Replicate did not start the generation", 502);
    }

    // ---------- Record it (or cancel it) ----------
    //
    // A running prediction that isn't in MongoDB would be
    // billed by Replicate but never tracked. Retry the
    // write; if it still fails, cancel the prediction.

    let recorded = false;

    for (let attempt = 1; attempt <= RECORD_ATTEMPTS && !recorded; attempt++) {
      try {
        await recordGeneration({
          predictionId,
          user: auth.user,
          project: projectRecord,
          model,
          version:
            typeof prediction.version === "string"
              ? prediction.version
              : latestVersion.id,
          inputs: shapedInputs,
          status: String(prediction.status ?? "starting"),
          createdAt:
            typeof prediction.created_at === "string"
              ? prediction.created_at
              : undefined,
        });
        recorded = true;
      } catch (error) {
        console.error(
          `Record generation failed (attempt ${attempt}):`,
          predictionId,
          error
        );
        if (attempt < RECORD_ATTEMPTS) await sleep(250 * attempt);
      }
    }

    if (!recorded) {
      const cancel = await fetch(
        replicateApiUrl(`predictions/${encodeURIComponent(predictionId)}/cancel`),
        { method: "POST", headers }
      ).catch(() => null);

      console.error(
        "UNTRACKED PREDICTION, cancel requested:",
        predictionId,
        cancel?.status ?? "cancel failed"
      );

      return badRequest(
        "Couldn't save this run, so it was cancelled. Please try again.",
        503
      );
    }

    return NextResponse.json({
      success: true,
      tracking: {
        predictionId,
        project: projectRecord.name,
        projectId: projectRecord.id,
        model,
        status: prediction.status,
      },
      prediction,
      costUsd: calculateReplicateCost(model, {
        ...prediction,
        input: shapedInputs,
      }),
    });
  } catch (error) {
    console.error("Generate API error:", error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

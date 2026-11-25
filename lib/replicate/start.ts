import type { StoredUser } from "@/lib/auth/users";
import { recordGeneration } from "@/lib/generations";
import { findActiveProjectByName } from "@/lib/projects";
import type { PublicProject } from "@/lib/auth/roles";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  replicateHeaders,
} from "@/lib/replicate/api";
import { calculateReplicateCost } from "@/lib/replicate/cost";
import {
  inputSchemaFromModel,
  missingRequired,
  shapeInputs,
} from "@/lib/replicate/inputs";
import { isValidModelId, modelPath } from "@/lib/replicate/model";
import { checkProjectBudget } from "@/lib/project-budgets/server";

// --------------------------------------------------
// START A REPLICATE GENERATION
//
// Shared by the website (/api/generate, with a signed-in
// session) and the Naar Studio API (/api/v1/generations,
// with an API key). Validates the request, starts the
// prediction and records it in MongoDB; status, cost and
// expense are filled in later by polling and the history
// reconcile. Spend is always attributed to a user account
// and an active project (and the API key, when one
// started it).
// --------------------------------------------------

const RECORD_ATTEMPTS = 3;
const MAX_INPUT_BYTES = 100_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type StartReplicateInput = {
  user: StoredUser;
  project: unknown;
  model: unknown;
  inputs: unknown;
  apiKey?: { id: string; name: string } | null;
};

export type StartReplicateResult =
  | {
      ok: true;
      predictionId: string;
      project: PublicProject;
      model: string;
      version: string;
      inputs: Record<string, unknown>;
      prediction: Record<string, unknown>;
      // Our estimate from the inputs (null: priced at the end)
      costUsd: number | null;
    }
  | { ok: false; status: number; error: string; code?: string };

const fail = (error: string, status = 400): StartReplicateResult => ({ ok: false, status, error });

export async function startReplicateGeneration(input: StartReplicateInput): Promise<StartReplicateResult> {
  const { project, model, inputs } = input;

  // ---------- Validation ----------

  if (typeof project !== "string" || !project.trim()) {
    return fail("Project is required");
  }

  if (typeof model !== "string" || !model) {
    return fail("Model is required");
  }

  if (!isValidModelId(model)) {
    return fail("Invalid model ID");
  }

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return fail("Model inputs are required");
  }

  if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) {
    return fail("Model inputs are too large");
  }

  const headers = replicateHeaders({ "Content-Type": "application/json" });

  if (!headers) {
    console.error("REPLICATE_API_TOKEN is missing");
    return fail("Generation is not configured on the server", 500);
  }

  // Only active projects from the database can be billed
  const projectRecord = await findActiveProjectByName(project);

  if (!projectRecord) {
    return fail("Unknown or archived project");
  }

  // ---------- Model (for its version and input schema) ----------

  const modelResponse = await fetch(replicateApiUrl(`models/${modelPath(model)}`), { headers, cache: "no-store" });
  const modelData = await readReplicateJson(modelResponse);

  if (!modelResponse.ok) {
    return fail(
      replicateErrorMessage(modelData, "Failed to fetch the selected model"),
      modelResponse.status === 404 ? 404 : 502
    );
  }

  const latestVersion = modelData.latest_version as { id?: string } | undefined;

  if (!latestVersion?.id) {
    return fail("Selected model does not have a runnable version.");
  }

  const inputSchema = inputSchemaFromModel(modelData);
  const shapedInputs = shapeInputs(inputs as Record<string, unknown>, inputSchema);

  const missing = missingRequired(shapedInputs, inputSchema);

  if (missing.length) {
    return fail(`Missing required input: ${missing.join(", ")}`, 422);
  }

  // ---------- The project's budget ----------

  const budget = await checkProjectBudget(
    projectRecord,
    estimateRunUsd(model, shapedInputs)
  );

  if (!budget.ok) return budget;

  // ---------- Start the prediction ----------

  const predictionResponse = await fetch(replicateApiUrl(`models/${modelPath(model)}/predictions`), {
    method: "POST",
    headers,
    body: JSON.stringify({ input: shapedInputs }),
  });
  const prediction = await readReplicateJson(predictionResponse);

  if (!predictionResponse.ok) {
    // 4xx from Replicate is about the inputs: show it
    return fail(
      replicateErrorMessage(prediction, "Replicate rejected the request"),
      predictionResponse.status >= 500 ? 502 : 422
    );
  }

  const predictionId = typeof prediction.id === "string" ? prediction.id : "";

  if (!predictionId) {
    console.error("Replicate returned no prediction id", prediction);
    return fail("Replicate did not start the generation", 502);
  }

  const version = typeof prediction.version === "string" ? prediction.version : latestVersion.id;

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
        user: input.user,
        project: projectRecord,
        model,
        version,
        inputs: shapedInputs,
        status: String(prediction.status ?? "starting"),
        createdAt: typeof prediction.created_at === "string" ? prediction.created_at : undefined,
        apiKey: input.apiKey ?? null,
      });
      recorded = true;
    } catch (error) {
      console.error(`Record generation failed (attempt ${attempt}):`, predictionId, error);
      if (attempt < RECORD_ATTEMPTS) await sleep(250 * attempt);
    }
  }

  if (!recorded) {
    const cancel = await fetch(replicateApiUrl(`predictions/${encodeURIComponent(predictionId)}/cancel`), {
      method: "POST",
      headers,
    }).catch(() => null);

    console.error("UNTRACKED PREDICTION, cancel requested:", predictionId, cancel?.status ?? "cancel failed");

    return fail("Couldn't save this run, so it was cancelled. Please try again.", 503);
  }

  return {
    ok: true,
    predictionId,
    project: projectRecord,
    model,
    version,
    inputs: shapedInputs,
    prediction,
    costUsd: calculateReplicateCost(model, { ...prediction, input: shapedInputs }),
  };
}

// What this run should cost, from our price table (null:
// priced by length, known only at the end)
function estimateRunUsd(model: string, inputs: Record<string, unknown>): number | null {
  try {
    return calculateReplicateCost(model, { status: "succeeded", input: inputs });
  } catch {
    return null;
  }
}

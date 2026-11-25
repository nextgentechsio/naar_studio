import {
  APIError,
  AuthenticationError,
  CredentialsMissedError,
  NotEnoughCreditsError,
} from "@higgsfield/client/v2";
import type { StoredUser } from "@/lib/auth/users";
import type { PublicProject } from "@/lib/auth/roles";
import { recordGeneration } from "@/lib/generations";
import {
  cancelHiggsfieldRequest,
  checkInputVideos,
  findHiggsfieldModel,
  higgsfieldConfigured,
  quoteHiggsfield,
  shapeHiggsfieldInputs,
  startHiggsfield,
} from "@/lib/higgsfield/client";
import { approxMeteredCostUsd, higgsfieldPriceKind } from "@/lib/higgsfield/models";
import { findActiveProjectByName } from "@/lib/projects";
import { checkProjectBudget } from "@/lib/project-budgets/server";

// --------------------------------------------------
// START A HIGGSFIELD RUN (any model in its list)
//
// Shared by the website (/api/higgsfield/generate) and
// the Naar Studio API (/api/v1/generations). Validates,
// starts the run and records it in MongoDB (or cancels
// it); polling fills in the outcome.
// --------------------------------------------------

const RECORD_ATTEMPTS = 3;
const MAX_INPUT_BYTES = 100_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type StartHiggsfieldInput = {
  user: StoredUser;
  project: unknown;
  model: unknown;
  inputs: unknown;
  apiKey?: { id: string; name: string } | null;
};

export type StartHiggsfieldResult =
  | {
      ok: true;
      predictionId: string;
      project: PublicProject;
      model: string;
      inputs: Record<string, unknown>;
      // What it will cost if it succeeds: the quote, or for
      // metered models an estimate; null when unknown
      costUsd: number | null;
    }
  | { ok: false; status: number; error: string; code?: string };

const fail = (error: string, status = 400): StartHiggsfieldResult => ({ ok: false, status, error });

// A readable reason, without the error object itself:
// SDK errors can carry request headers (the credentials)
function startError(error: unknown): StartHiggsfieldResult {
  if (error instanceof NotEnoughCreditsError) {
    return fail("The Higgsfield account doesn't have enough credits. Top it up and try again.", 402);
  }

  if (error instanceof AuthenticationError || error instanceof CredentialsMissedError) {
    return fail("Higgsfield rejected the server's API key", 500);
  }

  if (error instanceof APIError) {
    const status = error.statusCode ?? 502;
    return fail(error.message || "Higgsfield rejected the request", status >= 500 ? 502 : 422);
  }

  return fail("Couldn't start the Higgsfield run. Please try again.", 502);
}

export async function startHiggsfieldGeneration(input: StartHiggsfieldInput): Promise<StartHiggsfieldResult> {
  const { project, model, inputs } = input;

  if (!higgsfieldConfigured()) {
    return fail("Higgsfield is not configured on the server", 500);
  }

  if (typeof project !== "string" || !project.trim()) {
    return fail("Project is required");
  }

  if (typeof model !== "string" || !model || model.length > 200) {
    return fail("Model is required");
  }

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return fail("Inputs are required");
  }

  if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) {
    return fail("Inputs are too large");
  }

  // Only active projects from the database can be billed
  const projectRecord = await findActiveProjectByName(project);

  if (!projectRecord) {
    return fail("Unknown or archived project");
  }

  // Only models Higgsfield lists, with their own settings
  let modelRecord: Awaited<ReturnType<typeof findHiggsfieldModel>>;

  try {
    modelRecord = await findHiggsfieldModel(model);
  } catch (error) {
    console.error("Higgsfield model list failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Couldn't reach Higgsfield. Please try again.", 502);
  }

  if (!modelRecord) return fail("Unknown Higgsfield model");

  const shaped = shapeHiggsfieldInputs(modelRecord, inputs as Record<string, unknown>);

  // Required and left blank (e.g. no prompt, no image)
  const missing = (modelRecord.input_schema?.required ?? []).filter((key) => {
    const value = shaped[key];
    return (
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.length)
    );
  });

  if (missing.length) {
    return fail(`Missing: ${missing.join(", ").replace(/_/g, " ")}`);
  }

  // Videos the model would refuse (e.g. too few pixels)
  const videoProblem = await checkInputVideos(model, shaped);
  if (videoProblem) return fail(videoProblem);

  let started: Awaited<ReturnType<typeof startHiggsfield>>;
  // Higgsfield's exact price for this run, asked for
  // alongside the start (models it can quote)
  const quoting = higgsfieldPriceKind(model) === "quoted" ? quoteHiggsfield(model, shaped) : Promise.resolve(null);

  // The project's budget, with the run's price: the quote
  // (waited for only when the project has a budget), else
  // our per-second estimate
  const budget = await checkProjectBudget(
    projectRecord,
    quoting.then((quote) => quote ?? approxMeteredCostUsd(model, shaped))
  );
  if (!budget.ok) return budget;

  try {
    started = await startHiggsfield(model, shaped);
  } catch (error) {
    console.error("Higgsfield start failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return startError(error);
  }

  const { requestId } = started;
  const quotedCostUsd = await quoting;

  // ---------- Record it (or cancel it) ----------
  //
  // A run that isn't in MongoDB would be billed but never
  // tracked. Retry the write; if it still fails, cancel.

  let recorded = false;

  for (let attempt = 1; attempt <= RECORD_ATTEMPTS && !recorded; attempt++) {
    try {
      await recordGeneration({
        predictionId: requestId,
        user: input.user,
        project: projectRecord,
        model,
        version: "",
        inputs: shaped,
        // The first status check fills in the outcome,
        // with its reason (e.g. too few credits)
        status: "starting",
        provider: "higgsfield",
        quotedCostUsd,
        apiKey: input.apiKey ?? null,
      });
      recorded = true;
    } catch (error) {
      console.error(`Record Higgsfield run failed (attempt ${attempt}):`, requestId, error);
      if (attempt < RECORD_ATTEMPTS) await sleep(250 * attempt);
    }
  }

  if (!recorded) {
    const cancel = await cancelHiggsfieldRequest(requestId).catch(() => null);

    console.error("UNTRACKED HIGGSFIELD RUN, cancel requested:", requestId, cancel?.status ?? "cancel failed");

    return fail("Couldn't save this run, so it was cancelled. Please try again.", 503);
  }

  return {
    ok: true,
    predictionId: requestId,
    project: projectRecord,
    model,
    inputs: shaped,
    costUsd: quotedCostUsd ?? approxMeteredCostUsd(model, shaped),
  };
}

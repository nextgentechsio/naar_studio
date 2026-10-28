import { NextResponse } from "next/server";
import {
  APIError,
  AuthenticationError,
  CredentialsMissedError,
  NotEnoughCreditsError,
} from "@higgsfield/client/v2";
import { requireUser } from "@/lib/auth/auth";
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

export const runtime = "nodejs";

// --------------------------------------------------
// START A HIGGSFIELD RUN (any model in its list)
//
// Same contract as /api/generate ({ project, model,
// inputs }): validate, start the run, record it in
// MongoDB (or cancel it), then the client polls
// /api/predictions/[id] like any other run.
//
// GET says whether the server has credentials, so the
// page can explain instead of failing on Generate.
// --------------------------------------------------

const RECORD_ATTEMPTS = 3;
const MAX_INPUT_BYTES = 100_000;

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({ enabled: higgsfieldConfigured() });
}

// A readable reason, without the error object itself:
// SDK errors can carry request headers (the credentials)
function startErrorResponse(error: unknown) {
  if (error instanceof NotEnoughCreditsError) {
    return badRequest(
      "The Higgsfield account doesn't have enough credits. Top it up and try again.",
      402
    );
  }

  if (error instanceof AuthenticationError || error instanceof CredentialsMissedError) {
    return badRequest("Higgsfield rejected the server's API key", 500);
  }

  if (error instanceof APIError) {
    const status = error.statusCode ?? 502;
    return badRequest(
      error.message || "Higgsfield rejected the request",
      status >= 500 ? 502 : 422
    );
  }

  return badRequest("Couldn't start the Higgsfield run. Please try again.", 502);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!higgsfieldConfigured()) {
    return badRequest("Higgsfield is not configured on the server", 500);
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Invalid request body");
  }

  const { project, model, inputs } = body as Record<string, unknown>;

  if (typeof project !== "string" || !project.trim()) {
    return badRequest("Project is required");
  }

  if (typeof model !== "string" || !model || model.length > 200) {
    return badRequest("Model is required");
  }

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return badRequest("Inputs are required");
  }

  if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) {
    return badRequest("Inputs are too large");
  }

  try {
    // Only active projects from the database can be billed
    const projectRecord = await findActiveProjectByName(project);

    if (!projectRecord) {
      return badRequest("Unknown or archived project");
    }

    // Only models Higgsfield lists, with their own settings
    let modelRecord: Awaited<ReturnType<typeof findHiggsfieldModel>>;

    try {
      modelRecord = await findHiggsfieldModel(model);
    } catch (error) {
      console.error(
        "Higgsfield model list failed:",
        error instanceof Error ? error.message : "unknown error"
      );
      return badRequest("Couldn't reach Higgsfield. Please try again.", 502);
    }

    if (!modelRecord) return badRequest("Unknown Higgsfield model");

    const input = shapeHiggsfieldInputs(
      modelRecord,
      inputs as Record<string, unknown>
    );

    // Required and left blank (e.g. no prompt, no image)
    const missing = (modelRecord.input_schema?.required ?? []).filter((key) => {
      const value = input[key];
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && !value.length)
      );
    });

    if (missing.length) {
      return badRequest(`Missing: ${missing.join(", ").replace(/_/g, " ")}`);
    }

    // Videos the model would refuse (e.g. too few pixels)
    const videoProblem = await checkInputVideos(model, input);
    if (videoProblem) return badRequest(videoProblem);

    let started: Awaited<ReturnType<typeof startHiggsfield>>;
    // Higgsfield's exact price for this run, asked for
    // alongside the start (models it can quote)
    const quoting =
      higgsfieldPriceKind(model) === "quoted"
        ? quoteHiggsfield(model, input)
        : Promise.resolve(null);

    try {
      started = await startHiggsfield(model, input);
    } catch (error) {
      console.error(
        "Higgsfield start failed:",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"
      );
      return startErrorResponse(error);
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
          user: auth.user,
          project: projectRecord,
          model,
          version: "",
          inputs: input,
          // The first status check fills in the outcome,
          // with its reason (e.g. too few credits)
          status: "starting",
          provider: "higgsfield",
          quotedCostUsd,
        });
        recorded = true;
      } catch (error) {
        console.error(`Record Higgsfield run failed (attempt ${attempt}):`, requestId, error);
        if (attempt < RECORD_ATTEMPTS) await sleep(250 * attempt);
      }
    }

    if (!recorded) {
      const cancel = await cancelHiggsfieldRequest(requestId).catch(() => null);

      console.error(
        "UNTRACKED HIGGSFIELD RUN, cancel requested:",
        requestId,
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
        predictionId: requestId,
        project: projectRecord.name,
        projectId: projectRecord.id,
        model,
        status: "starting",
      },
      // Same shape as /api/generate's, for the Generate page
      prediction: { id: requestId, status: "starting" },
      // What it will cost if it succeeds: the quote, or for
      // metered models a 16:9 estimate (the exact cost
      // comes when it finishes); null when unknown
      costUsd: quotedCostUsd ?? approxMeteredCostUsd(model, input),
    });
  } catch (error) {
    console.error("Higgsfield generate error:", error instanceof Error ? error.message : error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

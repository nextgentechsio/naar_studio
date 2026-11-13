import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { platformDenied } from "@/lib/auth/platform-access";
import { higgsfieldConfigured } from "@/lib/higgsfield/client";
import { startHiggsfieldGeneration } from "@/lib/higgsfield/start";

export const runtime = "nodejs";

// --------------------------------------------------
// START A HIGGSFIELD RUN (the website)
//
// Same contract as /api/generate ({ project, model,
// inputs }); the work is in lib/higgsfield/start.ts,
// shared with the Naar Studio API. The client then polls
// /api/predictions/[id] like any other run.
//
// GET says whether the server has credentials, so the
// page can explain instead of failing on Generate.
// --------------------------------------------------

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({ enabled: higgsfieldConfigured() });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const denied = platformDenied(auth.user, "higgsfield");
  if (denied) return denied;

  if (!higgsfieldConfigured()) {
    return badRequest("Higgsfield is not configured on the server", 500);
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Invalid request body");
  }

  const { project, model, inputs } = body as Record<string, unknown>;

  try {
    const result = await startHiggsfieldGeneration({ user: auth.user, project, model, inputs });

    if (!result.ok) return badRequest(result.error, result.status);

    return NextResponse.json({
      success: true,
      tracking: {
        predictionId: result.predictionId,
        project: result.project.name,
        projectId: result.project.id,
        model: result.model,
        status: "starting",
      },
      // Same shape as /api/generate's, for the Generate page
      prediction: { id: result.predictionId, status: "starting" },
      costUsd: result.costUsd,
    });
  } catch (error) {
    console.error("Higgsfield generate error:", error instanceof Error ? error.message : error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

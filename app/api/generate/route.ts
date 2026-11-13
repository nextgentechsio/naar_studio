import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { platformDenied } from "@/lib/auth/platform-access";
import { startReplicateGeneration } from "@/lib/replicate/start";

export const runtime = "nodejs";

// --------------------------------------------------
// START A GENERATION (the website)
//
// The signed-in account starts a Replicate prediction;
// the work is in lib/replicate/start.ts, shared with the
// Naar Studio API (/api/v1/generations).
// --------------------------------------------------

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const denied = platformDenied(auth.user, "replicate");
  if (denied) return denied;

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Invalid request body");
  }

  const { project, model, inputs } = body as Record<string, unknown>;

  try {
    const result = await startReplicateGeneration({ user: auth.user, project, model, inputs });

    if (!result.ok) return badRequest(result.error, result.status);

    return NextResponse.json({
      success: true,
      tracking: {
        predictionId: result.predictionId,
        project: result.project.name,
        projectId: result.project.id,
        model: result.model,
        status: result.prediction.status,
      },
      prediction: result.prediction,
      costUsd: result.costUsd,
    });
  } catch (error) {
    console.error("Generate API error:", error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

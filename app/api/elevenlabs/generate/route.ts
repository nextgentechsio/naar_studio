import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { platformDenied } from "@/lib/auth/platform-access";
import { startElevenLabsGeneration } from "@/lib/elevenlabs/start";

export const runtime = "nodejs";
// The run happens after the response (lib/elevenlabs/
// start.ts); long enough for a 5-minute song
export const maxDuration = 300;

// --------------------------------------------------
// START AN ELEVENLABS RUN (the website)
//
// Same contract as /api/generate ({ project, model,
// inputs } → { prediction, tracking, costUsd }); the
// work is in lib/elevenlabs/start.ts, shared with the
// Naar Studio API. The page polls /api/predictions/[id]
// as for the other platforms.
// --------------------------------------------------

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const denied = platformDenied(auth.user, "elevenlabs");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { project, model, inputs } = body ?? {};

  try {
    const result = await startElevenLabsGeneration({ user: auth.user, project, model, inputs });

    if (!result.ok) return badRequest(result.error, result.status);

    return NextResponse.json({
      success: true,
      tracking: { predictionId: result.predictionId, project: result.project.name, projectId: result.project.id, model: result.model, status: "processing" },
      prediction: { id: result.predictionId, status: "processing" },
      costUsd: result.costUsd,
    });
  } catch (error) {
    console.error("ElevenLabs generate error:", error instanceof Error ? error.message : error);
    return badRequest("Generation failed. Please try again.", 500);
  }
}

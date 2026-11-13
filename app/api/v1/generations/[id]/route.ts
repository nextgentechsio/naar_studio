import { after, NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { getKeyGeneration, toApiGeneration } from "@/lib/api-keys/generations";
import { applyPrediction, fetchGenerationStatus, getGeneration, isTerminalStatus } from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// --------------------------------------------------
// GET one run: polls the provider while it's going, so
// the caller's own polling moves it along (status, cost
// and the saved output), the way the website does.
// --------------------------------------------------

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const generation = await getKeyGeneration(guard.caller.key, id);
  if (!generation) return apiError("not_found", "No generation with that id for this key.", 404);

  const origin = new URL(request.url).origin;

  try {
    if (isTerminalStatus(generation.status)) {
      return NextResponse.json(toApiGeneration(generation, origin));
    }

    const result = await fetchGenerationStatus(generation);
    if (!result.ok) {
      // Still the stored state; the caller just tries again
      return NextResponse.json(toApiGeneration(generation, origin), { headers: { "Retry-After": "3" } });
    }

    const prediction = result.prediction;

    if (prediction.status === "succeeded") {
      // Just finished: copy the output and bill after the
      // response; reads as "processing" until it's saved
      after(async () => {
        try {
          await applyPrediction(generation, prediction);
        } catch (error) {
          console.error("API apply prediction failed:", id, error);
        }
      });
      return NextResponse.json(toApiGeneration({ ...generation, status: "processing" }, origin), {
        headers: { "Retry-After": "2" },
      });
    }

    try {
      await applyPrediction(generation, prediction);
    } catch (error) {
      console.error("API apply prediction failed:", id, error);
    }

    const current = (await getGeneration(generation._id)) ?? generation;
    return NextResponse.json(toApiGeneration(current, origin));
  } catch (error) {
    console.error("API get generation error:", id, error);
    return apiError("server_error", "Couldn't read this generation.", 500);
  }
}

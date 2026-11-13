import { NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { getKeyGeneration, toApiGeneration } from "@/lib/api-keys/generations";
import { cancelGeneration } from "@/lib/generation-cancel";
import { getGeneration } from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST: stop one of this key's runs; answers with the run
// as it ended
export async function POST(request: Request, context: RouteContext) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  const generation = await getKeyGeneration(guard.caller.key, id);
  if (!generation) return apiError("not_found", "No generation with that id for this key.", 404);

  try {
    const result = await cancelGeneration(generation);
    if (!result.ok) {
      return apiError(result.status === 409 ? "already_finished" : "cancel_failed", result.error, result.status);
    }
    const current = (await getGeneration(generation._id)) ?? generation;
    return NextResponse.json(toApiGeneration(current, new URL(request.url).origin));
  } catch (error) {
    console.error("API cancel error:", id, error);
    return apiError("server_error", "Couldn't cancel this generation.", 500);
  }
}

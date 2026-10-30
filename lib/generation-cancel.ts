import { generationsCollection, providerName, type GenerationDoc } from "@/lib/db/mongodb";
import { applyPrediction, getGeneration, isTerminalStatus } from "@/lib/generations";
import { cancelHiggsfieldRequest } from "@/lib/higgsfield/client";
import { readReplicateJson, replicateApiUrl, replicateErrorMessage, replicateHeaders } from "@/lib/replicate/api";

// --------------------------------------------------
// CANCELLING A RUN (any platform)
//
// Replicate: asked to stop; it bills the seconds already
// used, and the run is recorded as canceled (no output,
// no expense).
// Higgsfield: asked to cancel, which it allows while the
// run waits in its queue (no credits used). Once it has
// started it can't be stopped and finishes as usual.
// ElevenLabs: runs in our own server, so it's marked
// canceled here; the run (lib/elevenlabs) sees that,
// stops its request and keeps nothing.
//
// A run that finished meanwhile keeps its result.
// --------------------------------------------------

export type CancelResult =
  | { ok: true; status: string }
  | { ok: false; status: number; error: string };

// Ends a still-running record as canceled
async function markCanceled(id: string): Promise<boolean> {
  const now = new Date();
  const result = await (await generationsCollection()).updateOne(
    { _id: id, status: { $nin: ["succeeded", "failed", "canceled", "unknown"] } },
    { $set: { status: "canceled", error: "Canceled", completedAt: now, updatedAt: now } }
  );
  return result.modifiedCount === 1;
}

// Whatever it ended as, when it ended before the cancel
async function settled(id: string): Promise<CancelResult> {
  const current = await getGeneration(id);
  return { ok: true, status: current?.status ?? "canceled" };
}

export async function cancelGeneration(generation: GenerationDoc): Promise<CancelResult> {
  if (isTerminalStatus(generation.status)) {
    return { ok: false, status: 409, error: "This run has already finished." };
  }

  const provider = generation.provider ?? "replicate";

  if (provider === "elevenlabs") {
    return (await markCanceled(generation._id)) ? { ok: true, status: "canceled" } : settled(generation._id);
  }

  if (provider === "higgsfield") {
    const response = await cancelHiggsfieldRequest(generation._id).catch(() => null);

    if (!response?.ok) {
      const body = await response?.text().catch(() => "");
      // Expected once a run has started: a warning, not an error
      console.warn("Higgsfield cancel refused:", generation._id, response?.status ?? "no response", body?.slice(0, 200));
      return {
        ok: false,
        status: 409,
        error:
          "Higgsfield can only cancel a run while it waits in the queue. This one has already started, so it will finish.",
      };
    }

    return (await markCanceled(generation._id)) ? { ok: true, status: "canceled" } : settled(generation._id);
  }

  const headers = replicateHeaders();
  if (!headers) return { ok: false, status: 500, error: "Replicate isn't set up on the server." };

  const response = await fetch(replicateApiUrl(`predictions/${encodeURIComponent(generation._id)}/cancel`), {
    method: "POST",
    headers,
  }).catch(() => null);

  if (!response) {
    return { ok: false, status: 502, error: `Couldn't reach ${providerName(provider)}. Try again.` };
  }

  const prediction = await readReplicateJson(response);

  if (!response.ok) {
    console.error("Replicate cancel failed:", generation._id, response.status);
    return {
      ok: false,
      status: response.status === 404 ? 404 : 502,
      error: replicateErrorMessage(prediction, "Replicate couldn't cancel this run."),
    };
  }

  // Record what Replicate says it is now (canceled, or
  // finished just before)
  if (isTerminalStatus(String(prediction.status ?? ""))) {
    await applyPrediction(generation, prediction);
    return settled(generation._id);
  }

  return (await markCanceled(generation._id)) ? { ok: true, status: "canceled" } : settled(generation._id);
}

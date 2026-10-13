import type { GridFSFile } from "mongodb";
import { generationsCollection, getDb } from "@/lib/mongodb";
import {
  deleteOutputBlobs,
  deleteOutputFile,
  OUTPUT_BLOB_FOLDER,
} from "@/lib/generation-outputs";
import { pruneOldBlobs, pruneOldInputs } from "@/lib/input-uploads";
import { OUTPUT_RETENTION_DAYS } from "@/lib/output-retention-days";

// --------------------------------------------------
// OUTPUT RETENTION
//
// Saved images and videos (Vercel Blob, or GridFS for
// older records) are kept for OUTPUT_RETENTION_DAYS only. The
// generation record and its expense stay forever (history
// and spend reports are unaffected); the record is marked
// `outputExpiredAt` so the UI can say why it's gone.
// Uploaded input files (lib/input-uploads.ts) follow the
// same period.
//
// Runs at most once an hour per server process, after a
// response (see scheduleOutputPrune), so no cron needed.
// --------------------------------------------------

export { OUTPUT_RETENTION_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 100;
// Bounded work per pass; the rest goes next hour
const MAX_BATCHES = 10;

export function outputCutoff(now: Date): Date {
  return new Date(now.getTime() - OUTPUT_RETENTION_DAYS * DAY_MS);
}

// What an expired record looks like: no saved copy left
function expiredFields(now: Date) {
  return {
    outputFileId: null,
    outputBlobUrl: null,
    localOutputUrl: null,
    // Replicate's copy expired long ago too
    outputUrl: null,
    outputSize: null,
    outputExpiredAt: now,
    updatedAt: now,
  };
}

// Deletes saved outputs older than the retention period,
// in Blob and in GridFS. Returns how many were removed.
export async function pruneExpiredOutputs(now = new Date()): Promise<number> {
  const generations = await generationsCollection();
  const cutoff = outputCutoff(now);
  let removed = 0;

  // 1. Records finished before the cutoff that still hold
  //    a saved copy (either store)
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const expired = await generations
      .find(
        {
          completedAt: { $lt: cutoff },
          $or: [{ outputBlobUrl: { $ne: null } }, { outputFileId: { $ne: null } }],
        },
        { projection: { _id: 1, outputBlobUrl: 1, outputFileId: 1 } }
      )
      .limit(BATCH_SIZE)
      .toArray();

    if (!expired.length) break;

    // Unlink first, so no record ever points at a
    // deleted file
    await generations.updateMany(
      { _id: { $in: expired.map((doc) => doc._id) } },
      { $set: expiredFields(now) }
    );

    // One call for the whole batch's Blob files (anything
    // left behind is caught by the outputs/ sweep)
    await deleteOutputBlobs(expired.map((doc) => doc.outputBlobUrl));
    for (const doc of expired) {
      await deleteOutputFile(doc.outputFileId);
    }

    removed += expired.length;

    if (expired.length < BATCH_SIZE) break;
  }

  // 2. Old GridFS files no finished record accounted for
  //    (e.g. a record without completedAt)
  const files = (await getDb()).collection<GridFSFile>("generationOutputs.files");

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = (
      await files
        .find({ uploadDate: { $lt: cutoff } }, { projection: { _id: 1 } })
        .limit(BATCH_SIZE)
        .toArray()
    ).map((file) => file._id);

    if (!ids.length) break;

    const linked = await generations
      .find({ outputFileId: { $in: ids } }, { projection: { outputBlobUrl: 1 } })
      .toArray();

    await generations.updateMany(
      { outputFileId: { $in: ids } },
      { $set: expiredFields(now) }
    );

    for (const id of ids) {
      await deleteOutputFile(id);
    }
    await deleteOutputBlobs(linked.map((doc) => doc.outputBlobUrl));

    removed += ids.length;

    if (ids.length < BATCH_SIZE) break;
  }

  return removed;
}

const globalForPrune = globalThis as unknown as {
  outputPruneLastRun?: number;
  outputPruneRunning?: boolean;
};

// Cheap to call on every request: runs a prune only if
// none ran in this process within the last hour
export async function maybePruneOutputs(): Promise<void> {
  const last = globalForPrune.outputPruneLastRun ?? 0;

  if (globalForPrune.outputPruneRunning || Date.now() - last < PRUNE_INTERVAL_MS) {
    return;
  }

  globalForPrune.outputPruneRunning = true;
  globalForPrune.outputPruneLastRun = Date.now();

  try {
    // Independent: one failing doesn't stop the other
    const results = await Promise.allSettled([
      pruneExpiredOutputs(),
      pruneOldInputs(),
      // Safety net: output files no record accounts for
      // (a delete that failed, a save that lost a race)
      pruneOldBlobs(OUTPUT_BLOB_FOLDER),
    ]);

    let removed = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") removed += result.value;
      else console.error(`Cleanup ${["outputs", "inputs", "output sweep"][index]} failed:`, result.reason);
    }
    if (removed) console.log(`Deleted ${removed} file(s) older than ${OUTPUT_RETENTION_DAYS} days`);
  } finally {
    globalForPrune.outputPruneRunning = false;
  }
}

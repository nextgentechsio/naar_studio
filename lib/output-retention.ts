import type { GridFSFile } from "mongodb";
import { generationsCollection, getDb } from "@/lib/mongodb";
import { deleteOutputFile } from "@/lib/generation-outputs";
import { OUTPUT_RETENTION_DAYS } from "@/lib/output-retention-days";

// --------------------------------------------------
// OUTPUT RETENTION
//
// Saved images and videos are the bulk of the database,
// so they are kept for OUTPUT_RETENTION_DAYS only. The
// generation record and its expense stay forever (history
// and spend reports are unaffected); the record is marked
// `outputExpiredAt` so the UI can say why it's gone.
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

// Deletes saved outputs older than the retention period.
// Returns how many files were removed.
export async function pruneExpiredOutputs(now = new Date()): Promise<number> {
  // The "generationOutputs" GridFS bucket's file list
  const files = (await getDb()).collection<GridFSFile>("generationOutputs.files");
  const generations = await generationsCollection();
  const cutoff = outputCutoff(now);
  let removed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const ids = (
      await files
        .find({ uploadDate: { $lt: cutoff } }, { projection: { _id: 1 } })
        .limit(BATCH_SIZE)
        .toArray()
    ).map((file) => file._id);

    if (!ids.length) break;

    // Unlink first, so no record ever points at a
    // deleted file
    await generations.updateMany(
      { outputFileId: { $in: ids } },
      {
        $set: {
          outputFileId: null,
          localOutputUrl: null,
          // Replicate's copy expired long ago too
          outputUrl: null,
          outputSize: null,
          outputExpiredAt: now,
          updatedAt: now,
        },
      }
    );

    for (const id of ids) {
      await deleteOutputFile(id);
    }

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
    const removed = await pruneExpiredOutputs();
    if (removed) console.log(`Deleted ${removed} saved output(s) older than ${OUTPUT_RETENTION_DAYS} days`);
  } catch (error) {
    console.error("Output cleanup failed:", error);
  } finally {
    globalForPrune.outputPruneRunning = false;
  }
}

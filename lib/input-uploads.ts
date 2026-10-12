import { del, list } from "@vercel/blob";
import { OUTPUT_RETENTION_DAYS } from "@/lib/output-retention-days";

// --------------------------------------------------
// INPUT FILES ON VERCEL BLOB
//
// Vercel rejects request bodies over 4.5 MB, so input
// files (reference images, videos, audio) go from the
// browser straight to Vercel Blob; Replicate then reads
// them from their public URL. /api/upload/blob only hands
// out short-lived, size- and type-limited upload tokens.
//
// Without BLOB_READ_WRITE_TOKEN (e.g. local dev) the app
// falls back to /api/upload (through our server).
//
// Uploads are deleted after the same retention period as
// saved outputs.
// --------------------------------------------------

export const INPUT_PREFIX = "inputs/";
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const INPUT_CONTENT_TYPES = ["image/*", "video/*", "audio/*"];

export function blobUploadsEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Bounded work per pass; the rest goes next time
const MAX_PAGES = 10;

// Deletes uploaded inputs older than the retention
// period. Returns how many were removed.
export async function pruneOldInputs(now = new Date()): Promise<number> {
  if (!blobUploadsEnabled()) return 0;

  const cutoff = new Date(now.getTime() - OUTPUT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let cursor: string | undefined;
  let removed = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await list({ prefix: INPUT_PREFIX, cursor, limit: 1000 });

    const expired = result.blobs
      .filter((blob) => new Date(blob.uploadedAt) < cutoff)
      .map((blob) => blob.url);

    if (expired.length) {
      await del(expired);
      removed += expired.length;
    }

    if (!result.hasMore || !result.cursor) break;
    cursor = result.cursor;
  }

  return removed;
}

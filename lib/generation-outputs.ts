import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { del, put } from "@vercel/blob";
import { ObjectId } from "mongodb";
import { blobUploadsEnabled } from "@/lib/input-uploads";
import { generationOutputsBucket } from "@/lib/mongodb";

// --------------------------------------------------
// SAVED OUTPUTS
//
// Replicate's output links expire, so each finished
// run's first output is copied to our own storage:
// Vercel Blob when configured (BLOB_READ_WRITE_TOKEN),
// else MongoDB GridFS "generationOutputs" (local dev,
// and older records). Either way they are served only
// to people allowed to see the run, through
// /api/generations/[id]/output; the Blob link itself
// is unguessable and never sent to the browser.
// --------------------------------------------------

const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SERVABLE_TYPES = /^(image|video|audio)\//;

// Exactly one of fileId (GridFS) / blobUrl (Blob) is set
export type SavedOutput = {
  fileId: ObjectId | null;
  blobUrl: string | null;
  contentType: string;
  size: number;
};

const BLOB_FOLDER = "outputs/";
const MULTIPART_BYTES = 50 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

export function outputUrlFor(generationId: string): string {
  return `/api/generations/${encodeURIComponent(generationId)}/output`;
}

// Copies the file at `url` into GridFS. Streams, with a
// size cap and a timeout; returns null (and leaves no
// partial file) if anything goes wrong.
export async function saveOutput(
  generationId: string,
  url: string
): Promise<SavedOutput | null> {
  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Output download failed:", generationId, error);
    return null;
  }

  if (!response.ok || !response.body) {
    console.error("Output download failed:", generationId, response.status);
    return null;
  }

  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_OUTPUT_BYTES) {
    console.error("Output too large:", generationId, declared);
    return null;
  }

  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const contentType = SERVABLE_TYPES.test(type) ? type : "application/octet-stream";

  let size = 0;
  const limit = () =>
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > MAX_OUTPUT_BYTES ? new Error("Output too large") : null, chunk);
      },
    });
  const source = () =>
    Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);

  if (blobUploadsEnabled()) {
    try {
      const blob = await put(
        `${BLOB_FOLDER}${generationId.replace(/[^\w.-]+/g, "_")}${EXTENSIONS[contentType] ?? ""}`,
        source().pipe(limit()),
        {
          access: "public",
          addRandomSuffix: true,
          contentType,
          multipart: !(declared > 0 && declared <= MULTIPART_BYTES),
        }
      );

      return { fileId: null, blobUrl: blob.url, contentType, size };
    } catch (error) {
      console.error("Output save failed:", generationId, error);
      return null;
    }
  }

  const bucket = await generationOutputsBucket();
  const upload = bucket.openUploadStream(generationId, {
    metadata: { generationId, contentType },
  });

  try {
    await pipeline(source(), limit(), upload);
  } catch (error) {
    console.error("Output save failed:", generationId, error);
    await deleteOutputFile(upload.id);
    return null;
  }

  return { fileId: upload.id, blobUrl: null, contentType, size };
}

// Removes a saved output from wherever it lives
export async function deleteSavedOutput(
  saved: Pick<SavedOutput, "fileId" | "blobUrl"> | null | undefined
) {
  await Promise.all([
    deleteOutputFile(saved?.fileId),
    deleteOutputBlob(saved?.blobUrl),
  ]);
}

export async function deleteOutputBlob(url: string | null | undefined) {
  if (!url) return;

  try {
    await del(url);
  } catch (error) {
    // Only an orphaned file: log, don't fail the request
    console.error("Delete output blob error:", error);
  }
}

export async function deleteOutputFile(fileId: ObjectId | null | undefined) {
  if (!fileId) return;

  try {
    await (await generationOutputsBucket()).delete(fileId);
  } catch {
    // Already gone (or never fully written): nothing to do
  }
}

// Inclusive byte range for a `Range: bytes=a-b` header,
// or null when absent/unusable (send the whole file)
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;

  if (!match[1]) {
    // Suffix: the last N bytes
    const suffix = Number(match[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }

  if (start > end || start >= size) return "invalid";

  return { start, end };
}

export async function openOutput(
  fileId: ObjectId,
  range: { start: number; end: number } | null
): Promise<ReadableStream<Uint8Array>> {
  const stream = (await generationOutputsBucket()).openDownloadStream(
    fileId,
    // GridFS `end` is exclusive
    range ? { start: range.start, end: range.end + 1 } : undefined
  );

  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

// Same contract as openOutput, for a copy in Blob. The
// range is forwarded, so only the requested bytes move.
export async function openBlobOutput(
  url: string,
  range: { start: number; end: number } | null
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(url, {
    headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
    cache: "no-store",
  });

  // A range covering the whole file may come back as a
  // plain 200, which is then exactly the requested bytes
  const wholeFile =
    response.status === 200 &&
    (!range ||
      (range.start === 0 &&
        Number(response.headers.get("content-length")) === range.end + 1));

  if (!(wholeFile || (range && response.status === 206)) || !response.body) {
    throw new Error(`Blob read failed: ${response.status}`);
  }

  return response.body;
}

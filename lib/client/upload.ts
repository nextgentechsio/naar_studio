import { upload } from "@vercel/blob/client";
import { fetchJson } from "@/lib/client/http";

// --------------------------------------------------
// INPUT FILE UPLOAD (browser only)
//
// Straight to Vercel Blob when the server has it set up
// (Vercel caps requests through our server at 4.5 MB);
// otherwise through /api/upload, e.g. in local dev. See
// lib/input-uploads.ts. Returns a URL Replicate can read.
// --------------------------------------------------

// Above this, Blob uploads in parallel parts with retries
const MULTIPART_BYTES = 8 * 1024 * 1024;

// A progress upload with no progress after this long
// is given up for a plain one
const PROGRESS_WAIT_MS = 8000;

let directEnabled: Promise<boolean> | null = null;

function directUploadsEnabled(): Promise<boolean> {
  directEnabled ??= fetchJson<{ enabled?: boolean }>("/api/upload/blob")
    .then((data) => Boolean(data.enabled))
    .catch(() => {
      // Ask again next time
      directEnabled = null;
      return false;
    });

  return directEnabled;
}

// onProgress gets 0–100, or null once progress can't
// be told; only direct uploads report it
export async function uploadInputFile(
  file: File,
  onProgress?: (percent: number | null) => void
): Promise<string> {
  if (await directUploadsEnabled()) {
    // Safe characters only; no ".." (the server refuses
    // paths containing it)
    const name =
      file.name
        .replace(/[^\w.-]+/g, "_")
        .replace(/\.{2,}/g, ".")
        .slice(-100) || "upload";

    const send = (
      progress?: (percent: number) => void,
      abortSignal?: AbortSignal
    ) =>
      upload(`inputs/${name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload/blob",
        contentType: file.type,
        multipart: file.size > MULTIPART_BYTES,
        abortSignal,
        onUploadProgress: progress
          ? ({ percentage }) => progress(percentage)
          : undefined,
      });

    if (!onProgress) return (await send()).url;

    // In Chrome, progress means a streamed request body,
    // which needs HTTP/2. Over HTTP/1.1 (some proxies) it
    // fails and the Blob client keeps retrying, so if no
    // progress shows up soon, send it the plain way.
    const watchdog = new AbortController();
    const timer = setTimeout(() => watchdog.abort(), PROGRESS_WAIT_MS);

    try {
      return (
        await send((percent) => {
          // It's getting through: no more watching
          if (percent > 0) clearTimeout(timer);
          onProgress(percent);
        }, watchdog.signal)
      ).url;
    } catch (err) {
      if (!watchdog.signal.aborted) throw err;

      onProgress(null);
      return (await send()).url;
    } finally {
      clearTimeout(timer);
    }
  }

  const body = new FormData();
  body.append("file", file, file.name);

  const data = await fetchJson<{ url?: string }>("/api/upload", {
    method: "POST",
    body,
  });

  if (!data.url) {
    throw new Error("Upload did not return a file URL.");
  }

  return data.url;
}

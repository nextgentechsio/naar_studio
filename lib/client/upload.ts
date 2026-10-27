import { upload } from "@vercel/blob/client";
import { fetchJson } from "@/lib/client/http";
import { HIGGSFIELD_UPLOAD_TYPES } from "@/lib/higgsfield-models";

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

// Safe characters only; no ".." (the server refuses
// paths containing it)
export function safeFileName(file: File): string {
  return (
    file.name
      .replace(/[^\w.-]+/g, "_")
      .replace(/\.{2,}/g, ".")
      .slice(-100) || "upload"
  );
}

// One file straight to Vercel Blob at pathname, with a
// token from handleUploadUrl. Returns its public URL.
export async function uploadToBlob(
  pathname: string,
  handleUploadUrl: string,
  file: File,
  onProgress?: (percent: number | null) => void
): Promise<string> {
  const send = (
    progress?: (percent: number) => void,
    abortSignal?: AbortSignal
  ) =>
    upload(pathname, file, {
      access: "public",
      handleUploadUrl,
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

// onProgress gets 0–100, or null once progress can't
// be told; only direct uploads report it
export async function uploadInputFile(
  file: File,
  onProgress?: (percent: number | null) => void
): Promise<string> {
  if (await directUploadsEnabled()) {
    return uploadToBlob(`inputs/${safeFileName(file)}`, "/api/upload/blob", file, onProgress);
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

// --------------------------------------------------
// HIGGSFIELD INPUTS
//
// Straight to Higgsfield's storage (a presigned link from
// /api/higgsfield/upload), so a run reads its files from
// Higgsfield's own CDN. Types it doesn't store, or a
// failed upload, fall back to Vercel Blob as above.
// --------------------------------------------------

type HiggsfieldUploadLink = {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  publicUrl: string;
};

// PUT with progress (fetch can't report upload progress)
function putFile(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Upload to Higgsfield failed (${request.status})`));
    request.onerror = () => reject(new Error("Upload to Higgsfield failed"));

    request.send(file);
  });
}

export async function uploadHiggsfieldInput(
  file: File,
  onProgress?: (percent: number | null) => void
): Promise<string> {
  if (!HIGGSFIELD_UPLOAD_TYPES.includes(file.type)) {
    return uploadInputFile(file, onProgress);
  }

  try {
    const link = await fetchJson<HiggsfieldUploadLink>("/api/higgsfield/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type }),
    });

    await putFile(link.uploadUrl, file, link.uploadHeaders, onProgress);
    return link.publicUrl;
  } catch (err) {
    console.warn("Higgsfield upload failed, using our storage instead:", err);
    onProgress?.(null);
    return uploadInputFile(file, onProgress);
  }
}

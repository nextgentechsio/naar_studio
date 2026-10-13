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

export async function uploadInputFile(file: File): Promise<string> {
  if (await directUploadsEnabled()) {
    // Safe characters only; no ".." (the server refuses
    // paths containing it)
    const name =
      file.name
        .replace(/[^\w.-]+/g, "_")
        .replace(/\.{2,}/g, ".")
        .slice(-100) || "upload";

    const blob = await upload(`inputs/${name}`, file, {
      access: "public",
      handleUploadUrl: "/api/upload/blob",
      contentType: file.type,
      multipart: file.size > MULTIPART_BYTES,
    });

    return blob.url;
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

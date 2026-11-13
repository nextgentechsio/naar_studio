import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { readReplicateJson, replicateApiUrl, replicateHeaders } from "@/lib/replicate/api";
import { blobUploadsEnabled, INPUT_PREFIX, MAX_INPUT_BYTES } from "@/lib/storage/input-uploads";
import { OUTPUT_RETENTION_DAYS } from "@/lib/storage/output-retention-days";

export const runtime = "nodejs";

// --------------------------------------------------
// POST an input file (multipart, field "file") and get a
// URL to use in a generation's input: an image, video or
// audio file. Stored in our Blob store under inputs/
// (kept as long as outputs are), or in Replicate's file
// store when Blob isn't configured.
// --------------------------------------------------

const ALLOWED_TYPES = /^(image|video|audio)\//;

export async function POST(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const declared = Number(request.headers.get("content-length"));
  if (!declared) return apiError("length_required", "Send the upload with a Content-Length.", 411);
  if (declared > MAX_INPUT_BYTES + 64 * 1024) return apiError("file_too_large", "Files must be 100 MB or smaller.", 413);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return apiError("invalid_request", 'Send a multipart form with the file in a "file" field.', 400);
  }
  if (file.size > MAX_INPUT_BYTES) return apiError("file_too_large", "Files must be 100 MB or smaller.", 413);
  if (!ALLOWED_TYPES.test(file.type)) {
    return apiError("unsupported_type", "Only image, video or audio files can be uploaded.", 415);
  }

  const name = (file.name || "upload").replace(/[^\w.-]+/g, "_").slice(0, 120);

  try {
    if (blobUploadsEnabled()) {
      const blob = await put(`${INPUT_PREFIX}api/${guard.caller.key._id.toHexString()}/${name}`, file, {
        access: "public",
        addRandomSuffix: true,
        contentType: file.type,
      });
      return NextResponse.json(
        { object: "file", url: blob.url, contentType: file.type, size: file.size, expiresInDays: OUTPUT_RETENTION_DAYS },
        { status: 201 }
      );
    }

    const headers = replicateHeaders();
    if (!headers) return apiError("server_error", "Uploads aren't configured on the server.", 500);

    const body = new FormData();
    body.append("content", file, name);
    const response = await fetch(replicateApiUrl("files"), { method: "POST", headers, body });
    const data = await readReplicateJson(response);
    const url = (data.urls as { get?: unknown } | undefined)?.get;
    if (!response.ok || typeof url !== "string" || !url) {
      console.error("API upload to Replicate failed:", response.status, data);
      return apiError("provider_error", "Upload failed. Try again.", 502);
    }
    return NextResponse.json({ object: "file", url, contentType: file.type, size: file.size, expiresInDays: null }, { status: 201 });
  } catch (error) {
    console.error("API upload error:", error);
    return apiError("server_error", "Upload failed. Try again.", 500);
  }
}

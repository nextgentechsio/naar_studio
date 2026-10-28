import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  replicateHeaders,
  upstreamStatus,
} from "@/lib/replicate/api";

export const runtime = "nodejs";

// --------------------------------------------------
// INPUT FILE UPLOAD
//
// Forwards a user's input file (image, video, audio) to
// Replicate's file store and returns its URL for use as
// a model input. Bounded and typed, since the files go
// to the company's Replicate account.
// --------------------------------------------------

// Replicate's own per-file limit
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const ALLOWED_TYPES = /^(image|video|audio)\//;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const headers = replicateHeaders();

  if (!headers) {
    console.error("REPLICATE_API_TOKEN is missing");
    return fail("Uploads are not configured on the server", 500);
  }

  // Refuse oversized bodies before buffering them
  const declared = Number(request.headers.get("content-length"));

  if (!declared) {
    return fail("Upload size is required", 411);
  }

  if (declared > MAX_REQUEST_BYTES) {
    return fail("Files must be 100 MB or smaller", 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return fail("No file received", 400);
  }

  if (file.size > MAX_FILE_BYTES) {
    return fail("Files must be 100 MB or smaller", 413);
  }

  if (!ALLOWED_TYPES.test(file.type)) {
    return fail("Only image, video or audio files can be uploaded", 415);
  }

  try {
    const body = new FormData();
    body.append("content", file, file.name.slice(0, 200) || "upload");

    const response = await fetch(replicateApiUrl("files"), {
      method: "POST",
      headers,
      body,
    });
    const data = await readReplicateJson(response);

    if (!response.ok) {
      console.error("Replicate upload failed:", response.status, data);

      return fail(
        replicateErrorMessage(data, "Upload failed. Please try again."),
        upstreamStatus(response.status)
      );
    }

    const url = (data.urls as { get?: unknown } | undefined)?.get;

    if (typeof url !== "string" || !url) {
      console.error("Replicate upload returned no URL:", data);
      return fail("Upload failed. Please try again.", 502);
    }

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("Upload route error:", error);
    return fail("Upload failed. Please try again.", 500);
  }
}

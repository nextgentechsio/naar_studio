import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth/auth";
import {
  blobUploadsEnabled,
  INPUT_CONTENT_TYPES,
  INPUT_PREFIX,
  MAX_INPUT_BYTES,
} from "@/lib/storage/input-uploads";

export const runtime = "nodejs";

// --------------------------------------------------
// DIRECT UPLOADS TO VERCEL BLOB (see lib/storage/input-uploads.ts)
//
// GET:  is this available here? (else use /api/upload)
// POST: a time-limited upload token for one input file,
//       limited to media types and 100 MB. Signed-in
//       users only. No completion callback is used, so
//       Vercel never calls this route itself.
// --------------------------------------------------

// Long enough for a 100 MB upload on a slow connection
const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({ enabled: blobUploadsEnabled() });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!blobUploadsEnabled()) {
    return NextResponse.json({ error: "Direct uploads are not configured" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;

  if (body?.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(INPUT_PREFIX) || pathname.includes("..")) {
          throw new Error("Invalid upload path");
        }

        return {
          allowedContentTypes: INPUT_CONTENT_TYPES,
          maximumSizeInBytes: MAX_INPUT_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Upload token error:", error);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 400 });
  }
}

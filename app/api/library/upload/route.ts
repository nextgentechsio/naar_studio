import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth/auth";
import { INPUT_CONTENT_TYPES, MAX_INPUT_BYTES } from "@/lib/storage/input-uploads";
import { libraryEnabled, libraryFolder } from "@/lib/storage/media-library";

export const runtime = "nodejs";

// --------------------------------------------------
// UPLOAD TOKENS FOR THE MEDIA LIBRARY
//
// Like /api/upload/blob, but only for the signed-in
// user's own library folder. No completion callback: the
// browser registers the file at /api/library afterwards.
// --------------------------------------------------

// Long enough for a 100 MB upload on a slow connection
const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!libraryEnabled()) {
    return NextResponse.json({ error: "The library is not set up on the server" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;

  if (body?.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const folder = libraryFolder(auth.user.id);

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(folder) || pathname.includes("..")) {
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
    console.error("Library upload token error:", error);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 400 });
  }
}

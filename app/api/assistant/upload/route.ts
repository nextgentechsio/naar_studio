import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth/auth";
import { ATTACHMENT_TYPES, assistantFolder, MAX_PDF_BYTES } from "@/lib/assistant/shared";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";

export const runtime = "nodejs";

// --------------------------------------------------
// UPLOAD TOKENS FOR ASSISTANT ATTACHMENTS
//
// The browser uploads straight to Blob storage, only into
// the signed-in user's own assistant/ folder, only images
// and PDFs. Sizes per kind are checked again when the
// message is sent (lib/assistant/attachments.ts).
// --------------------------------------------------

const TOKEN_TTL_MS = 30 * 60 * 1000;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!blobUploadsEnabled()) {
    return NextResponse.json({ error: "File uploads aren't set up on the server" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (body?.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  const folder = assistantFolder(auth.user.id);

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(folder) || pathname.includes("..")) {
          throw new Error("Invalid upload path");
        }
        return {
          allowedContentTypes: ATTACHMENT_TYPES,
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Assistant upload token error:", error);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 400 });
  }
}

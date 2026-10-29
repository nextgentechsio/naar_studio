import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth/auth";
import { canUploadTo, cutsStorageEnabled } from "@/lib/cuts/server";
import { CUT_EXPORT_MAX_BYTES, CUT_MEDIA_MAX_BYTES } from "@/lib/cuts/types";

export const runtime = "nodejs";

// --------------------------------------------------
// UPLOAD TOKENS FOR NAAR CUTS
//
// Like /api/library/upload, but only into one of the
// user's own cuts: cuts/<userId>/<cutId>/media/ (images,
// videos, audio) or …/exports/ (rendered videos). No
// completion callback: the editor registers the file at
// /api/cuts/<id>/assets afterwards.
// --------------------------------------------------

// Long enough for a large export on a slow connection
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const CUT_PATH = /^cuts\/([^/]+)\/([^/]+)\/(media|exports)\/[^/]+$/;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!cutsStorageEnabled()) {
    return NextResponse.json({ error: "File storage is not set up on the server" }, { status: 501 });
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
        const match = CUT_PATH.exec(pathname);

        if (
          !match ||
          pathname.includes("..") ||
          match[1] !== auth.user.id ||
          !(await canUploadTo(auth.user.id, match[2]))
        ) {
          throw new Error("Invalid upload path");
        }

        const exporting = match[3] === "exports";

        return {
          allowedContentTypes: exporting ? ["video/*"] : ["image/*", "video/*", "audio/*"],
          maximumSizeInBytes: exporting ? CUT_EXPORT_MAX_BYTES : CUT_MEDIA_MAX_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Cut upload token error:", error);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 400 });
  }
}

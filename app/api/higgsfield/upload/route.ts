import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createHiggsfieldUpload, higgsfieldConfigured } from "@/lib/higgsfield";
import { HIGGSFIELD_UPLOAD_TYPES } from "@/lib/higgsfield-models";

export const runtime = "nodejs";

// --------------------------------------------------
// UPLOAD AN INPUT FILE TO HIGGSFIELD'S STORAGE
//
// POST { contentType } → { uploadUrl, uploadHeaders,
// publicUrl }. The browser PUTs the file to uploadUrl
// (a presigned link, valid an hour, our credentials never
// sent) and the run uses publicUrl, which Higgsfield reads
// from its own storage. Types Higgsfield doesn't store go
// to Vercel Blob instead (lib/client/upload.ts).
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({
    enabled: higgsfieldConfigured(),
    contentTypes: HIGGSFIELD_UPLOAD_TYPES,
  });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!higgsfieldConfigured()) {
    return NextResponse.json({ error: "Higgsfield is not configured on the server" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as { contentType?: unknown } | null;
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";

  if (!HIGGSFIELD_UPLOAD_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: "Higgsfield's storage takes JPEG, PNG, WEBP or GIF images, WAV audio and MP4 video" },
      { status: 400 }
    );
  }

  const upload = await createHiggsfieldUpload(contentType);

  if (!upload) {
    return NextResponse.json({ error: "Couldn't prepare the upload. Please try again." }, { status: 502 });
  }

  return NextResponse.json(upload);
}

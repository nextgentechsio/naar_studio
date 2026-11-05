import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth/auth";
import { platformDenied } from "@/lib/auth/platform-access";
import { catalogueCollections, libraryFolder, productFolder } from "@/lib/catalogue/db";
import { canEditLibrary } from "@/lib/catalogue/library";
import { canManageUsers } from "@/lib/auth/roles";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";

// --------------------------------------------------
// CATALOGUE UPLOADS (direct to Vercel Blob, kept; not
// under inputs/, so retention never removes them)
//
// catalogue/library/…                         admins
// catalogue/<owner>/products/<id>/inputs/…    whoever can
//                                             work on it
// --------------------------------------------------

const MAX_BYTES = 25 * 1024 * 1024;
const TOKEN_TTL_MS = 30 * 60 * 1000;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const denied = platformDenied(auth.user, "catalogue");
  if (denied) return denied;
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
        if (pathname.includes("..")) throw new Error("Invalid upload path");
        let allowed = false;
        if (pathname.startsWith(libraryFolder())) {
          allowed = canEditLibrary(auth.user);
        } else {
          const match = /^catalogue\/[^/]+\/products\/([0-9a-f]{24})\/inputs\/[^/]+$/.exec(pathname);
          if (match) {
            const { products } = await catalogueCollections();
            const doc = await products.findOne({ _id: new ObjectId(match[1]) });
            allowed =
              !!doc &&
              (doc.userId === auth.user.id || canManageUsers(auth.user)) &&
              pathname.startsWith(`${productFolder(doc.userId, match[1])}inputs/`);
          }
        }
        if (!allowed) throw new Error("Invalid upload path");
        return {
          allowedContentTypes: ["image/*"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Catalogue upload token error:", error);
    return NextResponse.json({ error: "Couldn't start the upload" }, { status: 400 });
  }
}

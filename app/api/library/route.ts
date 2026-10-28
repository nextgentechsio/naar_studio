import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  addLibraryFile,
  LIBRARY_KINDS,
  libraryEnabled,
  libraryFolder,
  listLibrary,
  type LibraryKind,
} from "@/lib/storage/media-library";

export const runtime = "nodejs";

// --------------------------------------------------
// THE SIGNED-IN USER'S MEDIA LIBRARY (lib/storage/media-library.ts)
//
// GET  ?kind=image|video|audio → { enabled, folder, files }
//      (no kind: files is empty)
// POST { url, name }           → { file }, after uploading
//      to `folder` through /api/library/upload
// --------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!libraryEnabled()) {
    return NextResponse.json({ enabled: false, folder: null, files: [] });
  }

  const kind = new URL(request.url).searchParams.get("kind");

  try {
    return NextResponse.json({
      enabled: true,
      folder: libraryFolder(auth.user.id),
      files: LIBRARY_KINDS.includes(kind as LibraryKind)
        ? await listLibrary(auth.user.id, kind as LibraryKind)
        : [],
    });
  } catch (error) {
    console.error("List library error:", error);
    return NextResponse.json({ error: "Couldn't load your library" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!libraryEnabled()) {
    return NextResponse.json({ error: "The library is not set up on the server" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown; name?: unknown } | null;

  if (typeof body?.url !== "string" || !body.url) {
    return NextResponse.json({ error: "A file URL is required" }, { status: 400 });
  }

  try {
    const result = await addLibraryFile(
      auth.user.id,
      body.url,
      typeof body.name === "string" ? body.name : ""
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ file: result.file });
  } catch (error) {
    console.error("Add library file error:", error);
    return NextResponse.json({ error: "Couldn't save the file to your library" }, { status: 500 });
  }
}

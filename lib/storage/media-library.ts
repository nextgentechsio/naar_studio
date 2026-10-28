import { del, head } from "@vercel/blob";
import { ObjectId } from "mongodb";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import {
  isDuplicateKeyError,
  libraryFilesCollection,
  type LibraryFileDoc,
} from "@/lib/db/mongodb";

// --------------------------------------------------
// MEDIA LIBRARY
//
// Input files (images, videos, audio) a user uploaded,
// kept so they can be picked again in later runs. The
// bytes live in Vercel Blob under library/<userId>/, a
// folder the 7-day input/output cleanup never touches;
// they stay until the user deletes them. MongoDB keeps
// the list.
//
// The browser uploads straight to Blob (a token from
// /api/library/upload, limited to the user's folder),
// then registers the file here. The details recorded
// come from Blob itself, never the browser.
// --------------------------------------------------

const LIBRARY_PREFIX = "library/";

export type LibraryKind = LibraryFileDoc["kind"];

export const LIBRARY_KINDS: LibraryKind[] = ["image", "video", "audio"];

// What the browser sees
export type LibraryFile = {
  id: string;
  url: string;
  name: string;
  kind: LibraryKind;
  contentType: string;
  size: number;
  createdAt: string;
};

// Newest first; enough for a picker
const LIST_LIMIT = 300;

export function libraryEnabled(): boolean {
  return blobUploadsEnabled();
}

// Each user's own folder; user ids are ours, but keep
// the path safe anyway
export function libraryFolder(userId: string): string {
  return `${LIBRARY_PREFIX}${userId.replace(/[^\w-]+/g, "_")}/`;
}

function libraryKind(contentType: string): LibraryKind | null {
  const kind = contentType.split("/")[0];
  return LIBRARY_KINDS.includes(kind as LibraryKind) ? (kind as LibraryKind) : null;
}

function toFile(doc: LibraryFileDoc): LibraryFile {
  return {
    id: doc._id.toHexString(),
    url: doc.url,
    name: doc.name,
    kind: doc.kind,
    contentType: doc.contentType,
    size: doc.size,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listLibrary(
  userId: string,
  kind?: LibraryKind
): Promise<LibraryFile[]> {
  const docs = await (await libraryFilesCollection())
    .find(kind ? { userId, kind } : { userId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIST_LIMIT)
    .toArray();

  return docs.map(toFile);
}

export type LibraryResult =
  | { ok: true; file: LibraryFile }
  | { ok: false; status: number; error: string };

// Records a file the browser just uploaded to the user's
// folder. Registering the same file twice returns the
// existing entry.
export async function addLibraryFile(
  userId: string,
  url: string,
  name: string
): Promise<LibraryResult> {
  let blob: Awaited<ReturnType<typeof head>>;

  try {
    blob = await head(url);
  } catch {
    return { ok: false, status: 404, error: "The uploaded file wasn't found" };
  }

  // Only files in the user's own folder: nobody can add
  // another user's (or an output's) file to their list
  if (!blob.pathname.startsWith(libraryFolder(userId)) || blob.pathname.includes("..")) {
    return { ok: false, status: 403, error: "That file isn't in your library folder" };
  }

  const kind = libraryKind(blob.contentType);

  if (!kind) {
    return { ok: false, status: 415, error: "Only image, video or audio files can be saved" };
  }

  const files = await libraryFilesCollection();
  const doc: LibraryFileDoc = {
    _id: new ObjectId(),
    userId,
    url: blob.url,
    pathname: blob.pathname,
    name: name.trim().slice(0, 200) || blob.pathname.split("/").pop() || "file",
    kind,
    contentType: blob.contentType,
    size: blob.size,
    createdAt: new Date(),
  };

  try {
    await files.insertOne(doc);
    return { ok: true, file: toFile(doc) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const existing = await files.findOne({ url: blob.url, userId });
    if (!existing) return { ok: false, status: 409, error: "File already saved" };
    return { ok: true, file: toFile(existing) };
  }
}

// Removes the entry and its file. Runs that used it keep
// their record, but the link stops working.
export async function deleteLibraryFile(
  userId: string,
  id: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!ObjectId.isValid(id)) {
    return { ok: false, status: 404, error: "File not found" };
  }

  const doc = await (await libraryFilesCollection()).findOneAndDelete({
    _id: new ObjectId(id),
    userId,
  });

  if (!doc) return { ok: false, status: 404, error: "File not found" };

  try {
    await del(doc.url);
  } catch (error) {
    // Only an orphaned file; the entry is gone either way
    console.error("Delete library file error:", error);
  }

  return { ok: true };
}

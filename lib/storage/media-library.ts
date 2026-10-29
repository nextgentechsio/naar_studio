import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { del, head, put } from "@vercel/blob";
import { ObjectId } from "mongodb";
import { blobUploadsEnabled, MAX_INPUT_BYTES } from "@/lib/storage/input-uploads";
import {
  isDuplicateKeyError,
  libraryFilesCollection,
  type LibraryFileDoc,
} from "@/lib/db/mongodb";
import type { StoredUser } from "@/lib/auth/users";
import { canViewGeneration, getGeneration } from "@/lib/generations";
import { currentNames } from "@/lib/names";
import { openOutput } from "@/lib/storage/generation-outputs";

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
  // Who added it: only in the super admin's list of
  // everyone's files
  addedBy?: { id: string; name: string };
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

// Every user's files of a kind, newest first, each with
// who added it (the super admin's view; the route checks)
export async function listAllLibrary(kind: LibraryKind): Promise<LibraryFile[]> {
  const docs = await (await libraryFilesCollection())
    .find({ kind })
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIST_LIMIT)
    .toArray();
  const { users } = await currentNames([], docs.map((doc) => doc.userId));

  return docs.map((doc) => ({
    ...toFile(doc),
    addedBy: { id: doc.userId, name: users.get(doc.userId) ?? "Deleted user" },
  }));
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
// anyOwner: the super admin's delete of another user's
// file (the route checks)
export async function deleteLibraryFile(
  userId: string,
  id: string,
  { anyOwner = false } = {}
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!ObjectId.isValid(id)) {
    return { ok: false, status: 404, error: "File not found" };
  }

  const doc = await (await libraryFilesCollection()).findOneAndDelete(
    anyOwner ? { _id: new ObjectId(id) } : { _id: new ObjectId(id), userId }
  );

  if (!doc) return { ok: false, status: 404, error: "File not found" };

  try {
    await del(doc.url);
  } catch (error) {
    // Only an orphaned file; the entry is gone either way
    console.error("Delete library file error:", error);
  }

  return { ok: true };
}

// --------------------------------------------------
// A RUN'S OUTPUT INTO THE LIBRARY
//
// "Save to library", and "Add to element" (elements are
// made of library images, so a generated image is copied
// in first). Only runs the viewer may see, finished, with
// a saved image, video or audio; the same run twice gives
// the same file.
// --------------------------------------------------

const MAX_COPY_BYTES = MAX_INPUT_BYTES;

const OUTPUT_FILES: Record<string, { kind: LibraryKind; extension: string }> = {
  "image/png": { kind: "image", extension: ".png" },
  "image/jpeg": { kind: "image", extension: ".jpg" },
  "image/webp": { kind: "image", extension: ".webp" },
  "image/gif": { kind: "image", extension: ".gif" },
  "video/mp4": { kind: "video", extension: ".mp4" },
  "video/webm": { kind: "video", extension: ".webm" },
  "video/quicktime": { kind: "video", extension: ".mov" },
  "audio/mpeg": { kind: "audio", extension: ".mp3" },
  "audio/wav": { kind: "audio", extension: ".wav" },
  "audio/x-wav": { kind: "audio", extension: ".wav" },
  "audio/ogg": { kind: "audio", extension: ".ogg" },
};

export async function saveGenerationToLibrary(
  actor: StoredUser,
  generationId: string
): Promise<LibraryResult> {
  if (!libraryEnabled()) {
    return { ok: false, status: 501, error: "The library is not set up on the server" };
  }

  const generation = await getGeneration(generationId);
  if (!generation || !canViewGeneration(actor, generation)) {
    return { ok: false, status: 404, error: "Generation not found" };
  }

  // "image/png; charset=…" → "image/png"
  const contentType = (generation.outputContentType ?? "").split(";")[0].trim().toLowerCase();
  const type = OUTPUT_FILES[contentType];
  if (generation.status !== "succeeded" || !(generation.outputBlobUrl || generation.outputFileId)) {
    return { ok: false, status: 409, error: "This result is still being saved. Try again in a moment." };
  }
  if (!type) {
    return { ok: false, status: 415, error: "This kind of file can't be saved to the library." };
  }

  const files = await libraryFilesCollection();
  const existing = await files.findOne({ userId: actor.id, fromGenerationId: generationId });
  if (existing) return { ok: true, file: toFile(existing) };

  // The saved copy's bytes, from Blob or GridFS
  let bytes: Buffer;
  if (generation.outputBlobUrl) {
    const response = await fetch(generation.outputBlobUrl, { cache: "no-store" });
    if (!response.ok) {
      await response.text().catch(() => "");
      return { ok: false, status: 502, error: "Couldn't read the result. Please try again." };
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.fromWeb(
      (await openOutput(generation.outputFileId!, null)) as unknown as NodeReadableStream<Uint8Array>
    )) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length > MAX_COPY_BYTES) {
    return { ok: false, status: 413, error: "This file is too large for the library." };
  }

  const name = `run-${generationId.slice(0, 8)}${type.extension}`;
  const blob = await put(`${libraryFolder(actor.id)}${name}`, bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  const doc: LibraryFileDoc = {
    _id: new ObjectId(),
    userId: actor.id,
    url: blob.url,
    pathname: blob.pathname,
    name,
    kind: type.kind,
    contentType,
    size: bytes.length,
    fromGenerationId: generationId,
    createdAt: new Date(),
  };
  await files.insertOne(doc);

  return { ok: true, file: toFile(doc) };
}

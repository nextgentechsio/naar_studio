import { del, list, put } from "@vercel/blob";
import { ObjectId } from "mongodb";
import { canViewAllMedia } from "@/lib/auth/roles";
import type { StoredUser } from "@/lib/auth/users";
import { libraryFilesCollection } from "@/lib/db/mongodb";
import { currentNames } from "@/lib/names";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import { fetchRemoteMedia, RemoteError } from "./remote";
import {
  boardAssetsCollection,
  boardItemsCollection,
  boardsCollection,
  type BoardAssetDoc,
  type BoardDoc,
  type BoardItemDoc,
} from "./db";
import {
  cleanOp,
  MAX_BOARD_NAME,
  MAX_ITEMS,
  MAX_OPS_PER_SAVE,
  patchItem,
  type BoardItem,
  type BoardOp,
  type PublicBoard,
} from "./shared";

// --------------------------------------------------
// NAAR BOARDS: SERVER
//
// Boards are their owner's (phase 1). The super admin
// can also open everyone's, read only. Media placed on a
// board is copied into Blob boards/<boardId>/ so the board
// never loses a picture when a library file, element or
// output goes away.
// --------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const BOARD_FOLDER = "boards/";
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MEDIA_TYPES = /^(image|video)\//;

const folderOf = (boardId: string) => `${BOARD_FOLDER}${boardId}/`;
const itemKey = (boardId: string, itemId: string) => `${boardId}:${itemId}`;

function cleanName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name && name.length <= MAX_BOARD_NAME ? name : null;
}

async function present(docs: BoardDoc[]): Promise<PublicBoard[]> {
  const { users } = await currentNames([], docs.map((doc) => doc.ownerId));
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    name: doc.name,
    ownerId: doc.ownerId,
    ownerName: users.get(doc.ownerId) ?? "Deleted user",
    coverUrl: doc.coverUrl,
    itemCount: doc.itemCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

// Everyone's boards, read only: the super admin
export function canViewAllBoards(actor: Pick<StoredUser, "role" | "disabled">): boolean {
  return !actor.disabled && actor.role === "super_admin";
}

// The board, when the actor may change it (its owner)
async function ownBoard(actor: StoredUser, id: string): Promise<BoardDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  return (await boardsCollection()).findOne({ _id: new ObjectId(id), ownerId: actor.id });
}

const toItem = (doc: BoardItemDoc): BoardItem => {
  const { id, type, x, y, w, h, z, data } = doc;
  return { id, type, x, y, w, h, z, data } as BoardItem;
};

// --------------------------------------------------
// BOARDS
// --------------------------------------------------

// "all": everyone's boards (the super admin only; anyone
// else gets their own)
export async function listBoards(actor: StoredUser, scope: "mine" | "all" = "mine"): Promise<PublicBoard[]> {
  const everyone = scope === "all" && canViewAllBoards(actor);
  const docs = await (await boardsCollection())
    .find(everyone ? {} : { ownerId: actor.id })
    .sort({ updatedAt: -1 })
    .limit(everyone ? 2000 : 500)
    .toArray();
  return present(docs);
}

export async function createBoard(actor: StoredUser, name: unknown): Promise<Result<PublicBoard>> {
  const clean = cleanName(name ?? "Untitled board");
  if (!clean) return fail(400, `Name must be 1–${MAX_BOARD_NAME} characters`);
  const now = new Date();
  const doc: BoardDoc = { _id: new ObjectId(), name: clean, ownerId: actor.id, coverUrl: null, itemCount: 0, rev: 0, createdAt: now, updatedAt: now };
  await (await boardsCollection()).insertOne(doc);
  return { ok: true, value: (await present([doc]))[0] };
}

// The owner's, or (read only) anyone's for the super admin
export async function getBoard(
  actor: StoredUser,
  id: string
): Promise<Result<{ board: PublicBoard; items: BoardItem[]; rev: number; readOnly: boolean }>> {
  if (!ObjectId.isValid(id)) return fail(404, "Board not found");
  const doc = await (await boardsCollection()).findOne({ _id: new ObjectId(id) });
  if (!doc || (doc.ownerId !== actor.id && !canViewAllBoards(actor))) return fail(404, "Board not found");
  const items = await (await boardItemsCollection()).find({ boardId: id }).toArray();
  return {
    ok: true,
    value: { board: (await present([doc]))[0], items: items.map(toItem), rev: doc.rev, readOnly: doc.ownerId !== actor.id },
  };
}

export async function renameBoard(actor: StoredUser, id: string, name: unknown): Promise<Result<PublicBoard>> {
  const clean = cleanName(name);
  if (!clean) return fail(400, `Name must be 1–${MAX_BOARD_NAME} characters`);
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  const updated = await (await boardsCollection()).findOneAndUpdate(
    { _id: doc._id },
    { $set: { name: clean, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  return { ok: true, value: (await present([updated!]))[0] };
}

export async function duplicateBoard(actor: StoredUser, id: string): Promise<Result<PublicBoard>> {
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  const now = new Date();
  const copy: BoardDoc = {
    ...doc,
    _id: new ObjectId(),
    name: `${doc.name} copy`.slice(0, MAX_BOARD_NAME),
    rev: 0,
    createdAt: now,
    updatedAt: now,
  };
  const newId = copy._id.toHexString();
  await (await boardsCollection()).insertOne(copy);

  // Items point at the same stored files; a file is only
  // deleted when no board uses it any more
  const items = await (await boardItemsCollection()).find({ boardId: id }).toArray();
  if (items.length) {
    await (await boardItemsCollection()).insertMany(
      items.map((item) => ({ ...item, _id: itemKey(newId, item.id), boardId: newId, rev: 0, updatedAt: now, updatedBy: actor.id }))
    );
  }
  const assets = await (await boardAssetsCollection()).find({ boardId: id }).toArray();
  if (assets.length) {
    await (await boardAssetsCollection()).insertMany(assets.map((asset) => ({ ...asset, _id: new ObjectId(), boardId: newId })));
  }
  return { ok: true, value: (await present([copy]))[0] };
}

export async function deleteBoard(actor: StoredUser, id: string): Promise<Result<null>> {
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  const assets = await (await boardAssetsCollection()).find({ boardId: id }).toArray();
  await (await boardItemsCollection()).deleteMany({ boardId: id });
  await (await boardAssetsCollection()).deleteMany({ boardId: id });
  await (await boardsCollection()).deleteOne({ _id: doc._id });

  // Files no other board (a duplicate) still uses
  if (blobUploadsEnabled() && assets.length) {
    const urls = assets.map((asset) => asset.url);
    const stillUsed = new Set(
      (await (await boardAssetsCollection()).find({ url: { $in: urls } }, { projection: { url: 1 } }).toArray()).map((asset) => asset.url)
    );
    const unused = urls.filter((url) => !stillUsed.has(url));
    if (unused.length) await del(unused).catch((error) => console.error("Board files delete failed:", id, error));
    // Leftovers in the board's own folder (e.g. a failed copy)
    if (!stillUsed.size) {
      const { blobs } = await list({ prefix: folderOf(id) }).catch(() => ({ blobs: [] }));
      if (blobs.length) await del(blobs.map((blob) => blob.url)).catch(() => undefined);
    }
  }
  return { ok: true, value: null };
}

// --------------------------------------------------
// SAVING: a batch of operations
// --------------------------------------------------

export async function saveOps(actor: StoredUser, id: string, rawOps: unknown): Promise<Result<{ rev: number; applied: number }>> {
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  if (!Array.isArray(rawOps) || !rawOps.length) return fail(400, "No changes sent");
  if (rawOps.length > MAX_OPS_PER_SAVE) return fail(413, `Send at most ${MAX_OPS_PER_SAVE} changes at once`);

  const ops: BoardOp[] = [];
  for (const raw of rawOps) {
    const op = cleanOp(raw);
    if (!op) return fail(400, "A change wasn't valid");
    ops.push(op);
  }

  // Pictures and videos must be this board's own copies
  const mediaUrls = ops.flatMap((op) =>
    op.kind === "put" && (op.item.type === "image" || op.item.type === "video") ? [op.item.data.url] : []
  );
  if (mediaUrls.length) {
    const known = await (await boardAssetsCollection()).countDocuments({ boardId: id, url: { $in: [...new Set(mediaUrls)] } });
    if (known !== new Set(mediaUrls).size) return fail(400, "Add pictures and videos through the board's media picker");
  }

  const collection = await boardItemsCollection();
  const boards = await boardsCollection();
  const bumped = await boards.findOneAndUpdate({ _id: doc._id }, { $inc: { rev: 1 } }, { returnDocument: "after" });
  const rev = bumped!.rev;
  const now = new Date();
  let applied = 0;

  // Applied in order, one item at a time, so patches merge
  // into whatever is stored now
  for (const op of ops) {
    if (op.kind === "delete") {
      const result = await collection.deleteOne({ _id: itemKey(id, op.id) });
      applied += result.deletedCount;
      continue;
    }
    if (op.kind === "put") {
      if (!(await collection.findOne({ _id: itemKey(id, op.item.id) }, { projection: { _id: 1 } }))) {
        const count = await collection.countDocuments({ boardId: id });
        if (count >= MAX_ITEMS) return fail(413, `A board holds at most ${MAX_ITEMS.toLocaleString()} items`);
      }
      await collection.replaceOne(
        { _id: itemKey(id, op.item.id) },
        { ...op.item, boardId: id, rev, updatedAt: now, updatedBy: actor.id },
        { upsert: true }
      );
      applied++;
      continue;
    }
    const current = await collection.findOne({ _id: itemKey(id, op.id) });
    if (!current) continue;
    const next = patchItem(toItem(current), op.set);
    if (!next) continue;
    await collection.replaceOne({ _id: current._id }, { ...next, boardId: id, rev, updatedAt: now, updatedBy: actor.id });
    applied++;
  }

  // The list's cover and count
  const itemCount = await collection.countDocuments({ boardId: id });
  const cover =
    doc.coverUrl && (await collection.findOne({ boardId: id, "data.url": doc.coverUrl }, { projection: { _id: 1 } }))
      ? doc.coverUrl
      : ((await collection.findOne({ boardId: id, type: "image" }, { sort: { z: 1 }, projection: { data: 1 } }))?.data as { url?: string } | undefined)?.url ?? null;
  await boards.updateOne({ _id: doc._id }, { $set: { itemCount, coverUrl: cover, updatedAt: now } });

  return { ok: true, value: { rev, applied } };
}

// --------------------------------------------------
// MEDIA: a copy of a library file in the board's folder
// --------------------------------------------------

export type BoardAsset = { url: string; contentType: string; name: string; size: number };

export async function addBoardAsset(actor: StoredUser, id: string, sourceUrl: unknown): Promise<Result<BoardAsset>> {
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  if (!blobUploadsEnabled()) return fail(501, "File storage isn't set up on the server");
  if (typeof sourceUrl !== "string" || sourceUrl.length > 2000) return fail(400, "A file is required");

  const assets = await boardAssetsCollection();
  const existing = await assets.findOne({ boardId: id, $or: [{ sourceUrl }, { url: sourceUrl }] });
  if (existing) return { ok: true, value: toAsset(existing) };

  // Only the user's own library files (uploads, picked
  // outputs and element files all live there), or anyone's
  // for the super admin
  const file = await (await libraryFilesCollection()).findOne(
    canViewAllMedia(actor) ? { url: sourceUrl } : { url: sourceUrl, userId: actor.id }
  );
  if (!file) return fail(403, "That file isn't in your library");
  if (!MEDIA_TYPES.test(file.contentType)) return fail(415, "Only pictures and videos can go on a board");
  if (file.size > MAX_ASSET_BYTES) return fail(413, "Files must be 100 MB or smaller");

  const response = await fetch(file.url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return fail(502, "Couldn't read that file. Try again.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(0, 100) || "file";
  const blob = await put(`${folderOf(id)}${safe}`, bytes, { access: "public", addRandomSuffix: true, contentType: file.contentType });

  const asset: BoardAssetDoc = {
    _id: new ObjectId(),
    boardId: id,
    sourceUrl,
    url: blob.url,
    pathname: blob.pathname,
    contentType: file.contentType,
    size: bytes.length,
    name: file.name,
    createdBy: actor.id,
    createdAt: new Date(),
  };
  try {
    await assets.insertOne(asset);
  } catch {
    // Added twice at once: keep the first, drop this copy
    await del(blob.url).catch(() => undefined);
    const first = await assets.findOne({ boardId: id, sourceUrl });
    if (first) return { ok: true, value: toAsset(first) };
    throw new Error("Board asset save failed");
  }
  return { ok: true, value: toAsset(asset) };
}

// A picture or video from another website (pasted or
// dropped onto the board), saved into the board's folder
export async function addRemoteAsset(actor: StoredUser, id: string, remoteUrl: unknown): Promise<Result<BoardAsset>> {
  const doc = await ownBoard(actor, id);
  if (!doc) return fail(404, "Board not found");
  if (!blobUploadsEnabled()) return fail(501, "File storage isn't set up on the server");
  if (typeof remoteUrl !== "string" || remoteUrl.length > 4000) return fail(400, "A web address is required");

  const assets = await boardAssetsCollection();
  const existing = await assets.findOne({ boardId: id, sourceUrl: remoteUrl });
  if (existing) return { ok: true, value: toAsset(existing) };

  let file: Awaited<ReturnType<typeof fetchRemoteMedia>>;
  try {
    file = await fetchRemoteMedia(remoteUrl);
  } catch (error) {
    if (error instanceof RemoteError) return fail(422, error.message);
    return fail(502, "Couldn't download that picture. The website may not allow it.");
  }

  const blob = await put(`${folderOf(id)}${file.name}`, file.bytes, { access: "public", addRandomSuffix: true, contentType: file.contentType });
  const asset: BoardAssetDoc = {
    _id: new ObjectId(),
    boardId: id,
    sourceUrl: remoteUrl,
    url: blob.url,
    pathname: blob.pathname,
    contentType: file.contentType,
    size: file.bytes.length,
    name: file.name,
    createdBy: actor.id,
    createdAt: new Date(),
  };
  try {
    await assets.insertOne(asset);
  } catch {
    await del(blob.url).catch(() => undefined);
    const first = await assets.findOne({ boardId: id, sourceUrl: remoteUrl });
    if (first) return { ok: true, value: toAsset(first) };
    throw new Error("Board asset save failed");
  }
  return { ok: true, value: toAsset(asset) };
}

// One of the board's own files, for downloading or for
// drawing into a PNG of a selection: its owner, or the
// super admin (who can view every board)
export async function openBoardFile(
  actor: StoredUser,
  id: string,
  url: unknown
): Promise<Result<{ body: ReadableStream<Uint8Array>; contentType: string; name: string; size: number | null }>> {
  if (!ObjectId.isValid(id) || typeof url !== "string") return fail(404, "File not found");
  const board = await (await boardsCollection()).findOne({ _id: new ObjectId(id) });
  if (!board || (board.ownerId !== actor.id && !canViewAllBoards(actor))) return fail(404, "File not found");
  const asset = await (await boardAssetsCollection()).findOne({ boardId: id, url });
  if (!asset) return fail(404, "File not found");
  const response = await fetch(asset.url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return fail(502, "Couldn't read that file");
  }
  return { ok: true, value: { body: response.body, contentType: asset.contentType, name: asset.name, size: asset.size ?? null } };
}

const toAsset = (doc: BoardAssetDoc): BoardAsset => ({ url: doc.url, contentType: doc.contentType, name: doc.name, size: doc.size });

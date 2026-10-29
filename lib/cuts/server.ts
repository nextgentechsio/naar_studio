import { randomUUID } from "crypto";
import { del, head, list, put } from "@vercel/blob";
import type { StoredUser } from "@/lib/auth/users";
import { elementsCollection, isDuplicateKeyError } from "@/lib/db/mongodb";
import { canViewGeneration, getGeneration } from "@/lib/generations";
import { openOutput } from "@/lib/storage/generation-outputs";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import {
  cutAssetsCollection,
  cutsCollection,
  type CutAssetDoc,
  type CutDoc,
} from "@/lib/cuts/db";
import {
  CUT_EXPORT_MAX_BYTES,
  CUT_MEDIA_MAX_BYTES,
  CUT_NAME_MAX,
  CUT_PEAKS_MAX,
  CUT_TIMELINE_MAX_BYTES,
  cutExportsFolder,
  cutFolder,
  cutKindOf,
  cutMediaFolder,
  type CutAsset,
  type CutDetail,
  type CutSummary,
} from "@/lib/cuts/types";

// --------------------------------------------------
// NAAR CUTS: PROJECTS AND THEIR FILES (server side)
//
// Projects are private to their owner. Every file a
// project uses is its own copy in Blob under
// cuts/<userId>/<cutId>/ (media/ and exports/), so an
// edit never breaks when a run's output expires or an
// element's file is deleted. Outputs and element files
// are copied here on the server; uploads and exports go
// straight from the browser (a token limited to the
// project's folder, /api/cuts/upload) and are then
// registered, with their details read from Blob itself.
// --------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export function cutsStorageEnabled() {
  return blobUploadsEnabled();
}

// ---------- Shapes for the browser ----------

function toSummary(doc: CutDoc): CutSummary {
  return {
    id: doc._id,
    name: doc.name,
    durationMs: doc.durationMs,
    posterUrl: doc.posterUrl,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toDetail(doc: CutDoc): CutDetail {
  return { ...toSummary(doc), timeline: doc.timeline, version: doc.version };
}

function toAsset(doc: CutAssetDoc): CutAsset {
  return {
    id: doc._id,
    url: doc.url,
    kind: doc.kind,
    contentType: doc.contentType,
    size: doc.size,
    name: doc.name,
    source: doc.source.type,
    sourceRef:
      doc.source.type === "generation" ? doc.source.id : doc.source.type === "element" ? doc.source.url : null,
    durationMs: doc.durationMs ?? null,
    width: doc.width ?? null,
    height: doc.height ?? null,
    peaks: doc.peaks ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

function cleanName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name && name.length <= CUT_NAME_MAX ? name : null;
}

// ---------- Projects ----------

export async function listCuts(userId: string): Promise<CutSummary[]> {
  const docs = await (await cutsCollection())
    .find({ userId })
    .project<CutDoc>({ timeline: 0 })
    .sort({ updatedAt: -1, _id: -1 })
    .limit(500)
    .toArray();
  return docs.map(toSummary);
}

export async function createCut(userId: string, name: unknown): Promise<Result<CutDetail>> {
  const cleaned = name === undefined || name === "" ? "Untitled cut" : cleanName(name);
  if (!cleaned) return fail(400, `Name must be 1–${CUT_NAME_MAX} characters`);

  const now = new Date();
  const doc: CutDoc = {
    _id: randomUUID(),
    userId,
    name: cleaned,
    timeline: null,
    version: 1,
    durationMs: 0,
    posterUrl: null,
    createdAt: now,
    updatedAt: now,
  };

  await (await cutsCollection()).insertOne(doc);
  return { ok: true, value: toDetail(doc) };
}

async function ownCut(userId: string, cutId: string) {
  return (await cutsCollection()).findOne({ _id: cutId, userId });
}

export async function getCut(userId: string, cutId: string): Promise<CutDetail | null> {
  const doc = await ownCut(userId, cutId);
  return doc ? toDetail(doc) : null;
}

// Saves whichever fields are given. `version` must be
// the one last read: a newer save (another tab) wins
// and this one is refused, rather than silently lost.
export async function saveCut(
  userId: string,
  cutId: string,
  body: Record<string, unknown>
): Promise<Result<CutDetail>> {
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) return fail(400, "version is required");

  const set: Partial<CutDoc> = {};

  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return fail(400, `Name must be 1–${CUT_NAME_MAX} characters`);
    set.name = name;
  }

  if (body.timeline !== undefined) {
    if (body.timeline === null || typeof body.timeline !== "object" || Array.isArray(body.timeline)) {
      return fail(400, "Invalid timeline");
    }
    if (JSON.stringify(body.timeline).length > CUT_TIMELINE_MAX_BYTES) {
      return fail(413, "This timeline is too large to save");
    }
    set.timeline = body.timeline;
  }

  if (body.durationMs !== undefined) {
    const durationMs = Number(body.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) return fail(400, "Invalid duration");
    set.durationMs = Math.round(durationMs);
  }

  if (body.posterUrl !== undefined) {
    if (body.posterUrl === null) {
      set.posterUrl = null;
    } else {
      // Only one of the project's own files
      const asset =
        typeof body.posterUrl === "string"
          ? await (await cutAssetsCollection()).findOne({ cutId, userId, url: body.posterUrl })
          : null;
      if (!asset) return fail(400, "Invalid poster");
      set.posterUrl = asset.url;
    }
  }

  const cuts = await cutsCollection();
  const updated = await cuts.findOneAndUpdate(
    { _id: cutId, userId, version },
    { $set: { ...set, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: "after" }
  );

  if (updated) return { ok: true, value: toDetail(updated) };
  if (!(await ownCut(userId, cutId))) return fail(404, "Cut not found");
  return fail(409, "This cut was changed in another tab or window. Reload it to get the latest version.");
}

// The project, its records and every file in its folder
export async function deleteCut(userId: string, cutId: string): Promise<boolean> {
  const cut = await ownCut(userId, cutId);
  if (!cut) return false;

  if (cutsStorageEnabled()) await deleteFolder(cutFolder(userId, cutId));
  await (await cutAssetsCollection()).deleteMany({ cutId, userId });
  await (await cutsCollection()).deleteOne({ _id: cutId, userId });
  return true;
}

async function deleteFolder(prefix: string) {
  let cursor: string | undefined;

  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

// ---------- Files ----------

export async function listAssets(userId: string, cutId: string): Promise<CutAsset[] | null> {
  if (!(await ownCut(userId, cutId))) return null;

  const docs = await (await cutAssetsCollection()).find({ cutId, userId }).sort({ createdAt: 1 }).toArray();
  return docs.map(toAsset);
}

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
};

const safeName = (value: string) => value.replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").slice(-100) || "file";

// Streams `body` into the project's media folder: never
// held in memory whole, so long videos copy too
async function storeCopy(
  userId: string,
  cutId: string,
  name: string,
  contentType: string,
  body: ReadableStream<Uint8Array>
) {
  const blob = await put(`${cutMediaFolder(userId, cutId)}${safeName(name)}`, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
    multipart: true,
  });
  const details = await head(blob.url);
  return { url: blob.url, pathname: blob.pathname, size: details.size };
}

async function insertAsset(doc: CutAssetDoc): Promise<CutAsset> {
  const assets = await cutAssetsCollection();

  try {
    await assets.insertOne(doc);
    return toAsset(doc);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Added twice at once (two drops): keep the first
    // and remove this copy
    await del(doc.url).catch(() => {});
    const existing = await assets.findOne({ cutId: doc.cutId, sourceKey: doc.sourceKey });
    if (!existing) throw error;
    return toAsset(existing);
  }
}

// POST body: { source: "generation", id } |
// { source: "element", url } | { source: "upload" | "export", url }
export async function addAsset(
  actor: StoredUser,
  cutId: string,
  body: Record<string, unknown>
): Promise<Result<CutAsset>> {
  if (!cutsStorageEnabled()) return fail(501, "File storage is not set up on the server");

  const userId = actor.id;
  if (!(await ownCut(userId, cutId))) return fail(404, "Cut not found");

  switch (body.source) {
    case "generation":
      return addFromGeneration(actor, cutId, String(body.id ?? ""));
    case "element":
      return addFromElement(userId, cutId, String(body.url ?? ""));
    case "upload":
    case "export":
      return registerUpload(userId, cutId, body.source, String(body.url ?? ""), body.name);
    default:
      return fail(400, "Unknown source");
  }
}

async function existingAsset(cutId: string, sourceKey: string) {
  const doc = await (await cutAssetsCollection()).findOne({ cutId, sourceKey });
  return doc ? toAsset(doc) : null;
}

async function addFromGeneration(actor: StoredUser, cutId: string, generationId: string): Promise<Result<CutAsset>> {
  const sourceKey = `generation:${generationId}`;
  const existing = await existingAsset(cutId, sourceKey);
  if (existing) return { ok: true, value: existing };

  const generation = generationId ? await getGeneration(generationId) : null;
  if (!generation || !canViewGeneration(actor, generation)) return fail(404, "Generation not found");

  const contentType = (generation.outputContentType ?? "").split(";")[0].trim().toLowerCase();
  const kind = cutKindOf(contentType);

  if (generation.status !== "succeeded" || !(generation.outputBlobUrl || generation.outputFileId)) {
    return fail(409, "This result is still being saved, or has expired. Try again in a moment.");
  }
  if (!kind) return fail(415, "This kind of file can't be used in a cut");

  // The saved copy's bytes, from Blob or GridFS
  let body: ReadableStream<Uint8Array>;
  if (generation.outputBlobUrl) {
    const response = await fetch(generation.outputBlobUrl, { cache: "no-store" });
    if (!response.ok || !response.body) {
      await response.text().catch(() => "");
      return fail(502, "Couldn't read the result. Please try again.");
    }
    if (Number(response.headers.get("content-length")) > CUT_MEDIA_MAX_BYTES) {
      // Not awaited: cancel() on Next's server fetch can
      // hang forever
      void response.body.cancel().catch(() => {});
      return fail(413, "This file is too large for a cut");
    }
    body = response.body;
  } else {
    body = await openOutput(generation.outputFileId!, null);
  }

  const name = `run-${generationId.slice(0, 8)}${EXTENSIONS[contentType] ?? ""}`;
  const stored = await storeCopy(actor.id, cutId, name, contentType, body);

  return {
    ok: true,
    value: await insertAsset({
      _id: randomUUID(),
      cutId,
      userId: actor.id,
      ...stored,
      kind,
      contentType,
      name: generation.prompt ? generation.prompt.slice(0, 80) : name,
      source: { type: "generation", id: generationId },
      sourceKey,
      createdAt: new Date(),
    }),
  };
}

async function addFromElement(userId: string, cutId: string, url: string): Promise<Result<CutAsset>> {
  const sourceKey = `element:${url}`;
  const existing = await existingAsset(cutId, sourceKey);
  if (existing) return { ok: true, value: existing };

  // Only a file of one of the user's own elements
  const element = url
    ? await (await elementsCollection()).findOne({
        userId,
        $or: [{ images: url }, { videos: url }, { audios: url }],
      })
    : null;
  if (!element) return fail(404, "Element file not found");

  // Element files are library files in our own Blob
  // store: its details, before reading a byte
  let details: Awaited<ReturnType<typeof head>>;
  try {
    details = await head(url);
  } catch {
    return fail(404, "Element file not found");
  }

  const contentType = details.contentType.split(";")[0].trim().toLowerCase();
  const kind = cutKindOf(contentType);
  if (!kind) return fail(415, "This kind of file can't be used in a cut");
  if (details.size > CUT_MEDIA_MAX_BYTES) return fail(413, "This file is too large for a cut");

  const response = await fetch(details.url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok || !response.body) {
    await response?.text().catch(() => "");
    return fail(502, "Couldn't read the element's file. Please try again.");
  }

  const fileName = decodeURIComponent(details.pathname.split("/").pop() || "element");
  const stored = await storeCopy(userId, cutId, fileName, contentType, response.body);

  return {
    ok: true,
    value: await insertAsset({
      _id: randomUUID(),
      cutId,
      userId,
      ...stored,
      kind,
      contentType,
      name: `@${element.name}`,
      source: { type: "element", url },
      sourceKey,
      createdAt: new Date(),
    }),
  };
}

// A file the browser uploaded into the project's folder.
// `name` is the file's own name (Blob's has a random
// suffix); everything else comes from Blob.
async function registerUpload(
  userId: string,
  cutId: string,
  source: "upload" | "export",
  url: string,
  name: unknown
): Promise<Result<CutAsset>> {
  let details: Awaited<ReturnType<typeof head>>;
  try {
    details = await head(url);
  } catch {
    return fail(404, "Upload not found");
  }

  const folder = source === "export" ? cutExportsFolder(userId, cutId) : cutMediaFolder(userId, cutId);
  if (!details.pathname.startsWith(folder) || details.pathname.includes("..")) {
    return fail(400, "This file isn't in this cut's folder");
  }

  const existing = await existingAsset(cutId, details.pathname);
  if (existing) return { ok: true, value: existing };

  const contentType = details.contentType.split(";")[0].trim().toLowerCase();
  const kind = cutKindOf(contentType);
  const limit = source === "export" ? CUT_EXPORT_MAX_BYTES : CUT_MEDIA_MAX_BYTES;

  if (!kind || (source === "export" && kind !== "video") || details.size > limit) {
    await del(details.url).catch(() => {});
    return fail(415, "This file can't be used in a cut");
  }

  return {
    ok: true,
    value: await insertAsset({
      _id: randomUUID(),
      cutId,
      userId,
      url: details.url,
      pathname: details.pathname,
      size: details.size,
      kind: source === "export" ? "export" : kind,
      contentType,
      name:
        typeof name === "string" && name.trim()
          ? name.trim().slice(0, 120)
          : decodeURIComponent(details.pathname.split("/").pop() ?? "file"),
      source: { type: source },
      sourceKey: details.pathname,
      createdAt: new Date(),
    }),
  };
}

// What the browser measured: length, size, waveform
export async function updateAssetMeta(
  userId: string,
  cutId: string,
  assetId: string,
  body: Record<string, unknown>
): Promise<Result<CutAsset>> {
  const set: Partial<CutAssetDoc> = {};
  const positive = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  };

  if (body.durationMs !== undefined) set.durationMs = positive(body.durationMs);
  if (body.width !== undefined) set.width = positive(body.width);
  if (body.height !== undefined) set.height = positive(body.height);

  if (body.peaks !== undefined) {
    if (
      !Array.isArray(body.peaks) ||
      body.peaks.length > CUT_PEAKS_MAX ||
      !body.peaks.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ) {
      return fail(400, "Invalid waveform");
    }
    set.peaks = body.peaks as number[];
  }

  if (!Object.keys(set).length) return fail(400, "Nothing to update");

  const updated = await (await cutAssetsCollection()).findOneAndUpdate(
    { _id: assetId, cutId, userId },
    { $set: set },
    { returnDocument: "after" }
  );
  return updated ? { ok: true, value: toAsset(updated) } : fail(404, "File not found");
}

// The record and the file (clips using it are the
// editor's to remove)
export async function deleteAsset(userId: string, cutId: string, assetId: string): Promise<boolean> {
  const assets = await cutAssetsCollection();
  const asset = await assets.findOne({ _id: assetId, cutId, userId });
  if (!asset) return false;

  if (cutsStorageEnabled()) await del(asset.url).catch(() => {});
  await assets.deleteOne({ _id: assetId });

  const cuts = await cutsCollection();
  await cuts.updateOne({ _id: cutId, userId, posterUrl: asset.url }, { $set: { posterUrl: null } });
  return true;
}

// For /api/cuts/upload: the project must be the user's
export async function canUploadTo(userId: string, cutId: string) {
  return Boolean(await ownCut(userId, cutId));
}

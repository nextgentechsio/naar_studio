import { generationsCollection, type GenerationDoc } from "@/lib/db/mongodb";
import type { ApiKeyDoc } from "./db";

// --------------------------------------------------
// A KEY'S RUNS, AS THE API SHOWS THEM
//
// A key only ever sees the runs it started. Output files
// are served through our own URL (the saved copy), never
// the provider's or the storage bucket's.
// --------------------------------------------------

export type ApiGeneration = {
  id: string;
  object: "generation";
  platform: string;
  model: string;
  project: { id: string; name: string };
  // starting | processing | succeeded | failed | canceled
  status: string;
  error: string | null;
  input: Record<string, unknown>;
  output: { url: string; contentType: string | null } | null;
  // Seconds the model ran, from the provider when it says,
  // else start to finish
  runTime: number | null;
  costUsd: number | null;
  createdAt: string;
  completedAt: string | null;
};

const API_LIST_PROJECTION = {
  provider: 1,
  model: 1,
  projectId: 1,
  projectName: 1,
  status: 1,
  error: 1,
  inputs: 1,
  outputBlobUrl: 1,
  outputFileId: 1,
  outputContentType: 1,
  outputSize: 1,
  outputExpiredAt: 1,
  predictTime: 1,
  costUsd: 1,
  createdAt: 1,
  completedAt: 1,
  apiKeyId: 1,
} as const;

// The provider's run time when it reports one, else start
// to finish (as History shows it)
function runSeconds(doc: Pick<GenerationDoc, "predictTime" | "createdAt" | "completedAt">): number | null {
  if (typeof doc.predictTime === "number" && Number.isFinite(doc.predictTime) && doc.predictTime > 0) return doc.predictTime;
  if (!doc.completedAt) return null;
  const ms = doc.completedAt.getTime() - doc.createdAt.getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

export function hasSavedOutput(doc: Pick<GenerationDoc, "outputBlobUrl" | "outputFileId" | "outputSize" | "outputExpiredAt">) {
  return Boolean((doc.outputBlobUrl || doc.outputFileId) && typeof doc.outputSize === "number" && !doc.outputExpiredAt);
}

export function toApiGeneration(doc: GenerationDoc, origin: string): ApiGeneration {
  return {
    id: doc._id,
    object: "generation",
    platform: doc.provider ?? "replicate",
    model: doc.model,
    project: { id: doc.projectId, name: doc.projectName },
    status: doc.status,
    error: doc.error,
    input: doc.inputs ?? {},
    output: hasSavedOutput(doc)
      ? { url: `${origin}/api/v1/generations/${encodeURIComponent(doc._id)}/output`, contentType: doc.outputContentType ?? null }
      : null,
    runTime: runSeconds(doc),
    costUsd: doc.costUsd,
    createdAt: doc.createdAt.toISOString(),
    completedAt: doc.completedAt?.toISOString() ?? null,
  };
}

// One of this key's runs, or null (another key's reads as
// not found, so ids can't be probed)
export async function getKeyGeneration(key: ApiKeyDoc, id: string): Promise<GenerationDoc | null> {
  if (!id || id.length > 200) return null;
  return (await generationsCollection()).findOne({ _id: id, apiKeyId: key._id.toHexString() });
}

export const API_PAGE_SIZE = 20;
export const API_MAX_PAGE_SIZE = 100;

// Newest first, with an opaque cursor for the next page
export async function listKeyGenerations(
  key: ApiKeyDoc,
  options: { limit: number; cursor: string | null; status?: string | null }
): Promise<{ docs: GenerationDoc[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit) || API_PAGE_SIZE), API_MAX_PAGE_SIZE);
  const filter: Record<string, unknown> = { apiKeyId: key._id.toHexString() };
  if (options.status) filter.status = options.status;

  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    filter.$or = [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }];
  }

  const docs = await (await generationsCollection())
    .find(filter as never, { projection: API_LIST_PROJECTION })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    docs: page,
    nextCursor: docs.length > limit && last ? encodeCursor(last) : null,
  };
}

function encodeCursor(doc: Pick<GenerationDoc, "_id" | "createdAt">): string {
  return Buffer.from(JSON.stringify({ t: doc.createdAt.toISOString(), id: doc._id })).toString("base64url");
}

function decodeCursor(value: string | null): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as { t?: string; id?: string };
    const createdAt = new Date(parsed.t ?? "");
    if (Number.isNaN(createdAt.getTime()) || typeof parsed.id !== "string") return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

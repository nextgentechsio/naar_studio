import { recordExpense } from "@/lib/spend/expenses";
import {
  deleteSavedOutput,
  outputUrlFor,
  saveOutput,
  saveOutputBytes,
  type SavedOutput,
} from "@/lib/storage/generation-outputs";
import { currentNames } from "@/lib/names";
import type { Filter } from "mongodb";
import {
  checkHiggsfieldRequest,
  higgsfieldRunCostUsd,
  isHiggsfieldOutputUrl,
} from "@/lib/higgsfield/client";
import {
  providerName,
  expensesCollection,
  generationsCollection,
  providerMatch,
  type GenerationDoc,
  type Provider,
} from "@/lib/db/mongodb";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  replicateHeaders,
} from "@/lib/replicate/api";
import { calculateReplicateCost } from "@/lib/replicate/cost";
import { canHideGenerations, canManageUsers } from "@/lib/auth/roles";
import type { StoredUser } from "@/lib/auth/users";

// --------------------------------------------------
// GENERATION HISTORY (MongoDB "generations")
//
// Written by the server only: a record is created when
// /api/generate starts a prediction, and updated with
// status, cost and output whenever we hear back from
// Replicate (client polling or reconcilePending).
// --------------------------------------------------

// "unknown": Replicate lost the prediction (see
// reconcilePending); never billed
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "unknown",
]);

export function isTerminalStatus(status: unknown) {
  return (
    typeof status === "string" &&
    TERMINAL_STATUSES.has(status)
  );
}

export type PublicGeneration = {
  id: string;
  predictionId: string;
  provider: Provider;
  userId: string;
  user: string;
  projectId: string;
  project: string;
  model: string;
  prompt: string;
  inputImage: string | null;
  aspectRatio: string;
  resolution: string;
  status: string;
  error: string | null;
  costUsd: number | null;
  // Saved copy when available (Replicate URLs expire)
  outputUrl: string | null;
  // e.g. "video/mp4" for saved copies (their URL has no
  // file extension to go by)
  outputContentType: string | null;
  replicateOutputUrl: string | null;
  // Saved copy deleted after the retention period
  outputExpired: boolean;
  // Hidden from everyone but the super admin (only they
  // ever receive hidden runs)
  hidden: boolean;
  predictTime: number | null;
  createdAt: string;
  completedAt: string | null;
};

function toPublicGeneration(
  doc: GenerationDoc
): PublicGeneration {
  return {
    id: doc._id,
    predictionId: doc._id,
    provider: doc.provider ?? "replicate",
    userId: doc.userId,
    user: doc.userName,
    projectId: doc.projectId,
    project: doc.projectName,
    model: doc.model,
    prompt: doc.prompt,
    inputImage: doc.inputImage,
    aspectRatio: doc.aspectRatio,
    resolution: doc.resolution,
    status: doc.status,
    error: doc.error,
    costUsd: doc.costUsd,
    outputUrl: doc.localOutputUrl ?? doc.outputUrl,
    outputContentType: doc.outputContentType ?? null,
    replicateOutputUrl: doc.outputUrl,
    outputExpired: Boolean(doc.outputExpiredAt),
    hidden: Boolean(doc.hiddenAt),
    predictTime: doc.predictTime,
    createdAt: doc.createdAt.toISOString(),
    completedAt: doc.completedAt?.toISOString() ?? null,
  };
}

export function canViewGeneration(
  actor: StoredUser,
  generation: Pick<GenerationDoc, "userId" | "hiddenAt">
): boolean {
  // Hidden runs: the super admin only, even for their
  // owner or an admin
  if (generation.hiddenAt && !canHideGenerations(actor)) return false;

  return (
    generation.userId === actor.id ||
    canManageUsers(actor)
  );
}

function firstUrl(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [value];

  const url = candidates.find(
    (item): item is string =>
      typeof item === "string" &&
      /^https?:\/\//i.test(item)
  );

  return url ?? null;
}

// Keep stored inputs small (they are URLs and settings,
// but never trust that blindly).
const MAX_INPUTS_BYTES = 50_000;

function storableInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  return JSON.stringify(inputs).length <= MAX_INPUTS_BYTES
    ? inputs
    : { truncated: true };
}

// --------------------------------------------------
// CREATE
// --------------------------------------------------

export async function recordGeneration(input: {
  predictionId: string;
  user: StoredUser;
  project: { id: string; name: string };
  model: string;
  version: string;
  inputs: Record<string, unknown>;
  status: string;
  createdAt?: string;
  provider?: Provider;
  quotedCostUsd?: number | null;
}) {
  const now = new Date();

  const createdAt = input.createdAt
    ? new Date(input.createdAt)
    : now;

  const doc: GenerationDoc = {
    _id: input.predictionId,
    userId: input.user.id,
    userName: input.user.name,
    projectId: input.project.id,
    projectName: input.project.name,
    provider: input.provider ?? "replicate",
    model: input.model,
    version: input.version,
    prompt: String(input.inputs.prompt ?? ""),
    inputs: storableInputs(input.inputs),
    // Replicate's image_input, Higgsfield's image_url(s)
    inputImage: firstUrl(
      input.inputs.image_input ?? input.inputs.image_urls ?? input.inputs.image_url
    ),
    aspectRatio: String(input.inputs.aspect_ratio ?? ""),
    resolution: String(input.inputs.resolution ?? ""),
    status: input.status || "starting",
    error: null,
    costUsd: null,
    ...(input.quotedCostUsd != null && { quotedCostUsd: input.quotedCostUsd }),
    outputUrl: null,
    localOutputUrl: null,
    predictTime: null,
    createdAt: Number.isNaN(createdAt.getTime())
      ? now
      : createdAt,
    updatedAt: now,
    completedAt: null,
  };

  await (await generationsCollection()).insertOne(doc);
}

// --------------------------------------------------
// READ
// --------------------------------------------------

export async function getGeneration(
  id: string
): Promise<GenerationDoc | null> {
  return (await generationsCollection()).findOne({
    _id: id,
  });
}

// "hidden" is the super admin's view of hidden runs
export const HISTORY_STATUSES = [
  "succeeded",
  "failed",
  "running",
  "hidden",
] as const;

export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type HistoryQuery = {
  page?: number;
  pageSize?: number;
  projectId?: string;
  userId?: string;
  model?: string;
  status?: HistoryStatus;
  // Case-insensitive match on the prompt
  q?: string;
  // Replicate or Higgsfield
  provider?: Provider;
  // Created from (inclusive) / before (exclusive); the
  // browser sends its local midnights
  createdFrom?: Date;
  createdTo?: Date;
  // The filter dropdown values cost three extra queries
  // over all the viewer's runs; skip them when the page
  // already has them
  withOptions?: boolean;
};

export type HistoryPage = {
  generations: PublicGeneration[];
  total: number;
  page: number;
  pageSize: number;
  // Values that exist in what the viewer may see, for
  // the filter dropdowns; left out when not asked for
  options?: {
    projects: { id: string; name: string }[];
    users: { id: string; name: string }[];
    models: string[];
  };
};

const HISTORY_MAX_PAGE_SIZE = 60;

// What a list row shows (see toPublicGeneration): the
// stored inputs stay in the database
const LIST_PROJECTION = {
  provider: 1,
  userId: 1,
  userName: 1,
  projectId: 1,
  projectName: 1,
  model: 1,
  prompt: 1,
  inputImage: 1,
  aspectRatio: 1,
  resolution: 1,
  status: 1,
  error: 1,
  costUsd: 1,
  outputUrl: 1,
  localOutputUrl: 1,
  outputContentType: 1,
  outputExpiredAt: 1,
  hiddenAt: 1,
  predictTime: 1,
  createdAt: 1,
  completedAt: 1,
} as const;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STATUS_FILTERS: Record<HistoryStatus, Filter<GenerationDoc>> = {
  succeeded: { status: "succeeded" },
  failed: { status: { $in: ["failed", "canceled", "unknown"] } },
  running: { status: { $nin: [...TERMINAL_STATUSES] } },
  hidden: { hiddenAt: { $ne: null } },
};

export async function listGenerations(
  actor: StoredUser,
  query: HistoryQuery = {}
): Promise<HistoryPage> {
  const pageSize = Math.min(
    Math.max(1, Math.floor(query.pageSize ?? 24)),
    HISTORY_MAX_PAGE_SIZE
  );
  const requestedPage = Math.floor(query.page ?? 1);
  // Finite and bounded: skip(Infinity) makes Mongo throw
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(1, requestedPage), 100_000)
    : 1;

  // Plain users see only their own generations, so a
  // user filter only applies to managers. Hidden runs
  // exist only for the super admin (filter values too).
  const scope: Filter<GenerationDoc> = {
    ...(canManageUsers(actor) ? {} : { userId: actor.id }),
    ...(canHideGenerations(actor) ? {} : { hiddenAt: null }),
  };

  const filter: Filter<GenerationDoc> = { ...scope };

  if (query.projectId) filter.projectId = query.projectId;
  if (query.userId && canManageUsers(actor)) filter.userId = query.userId;
  if (query.model) filter.model = query.model;
  if (query.status && (query.status !== "hidden" || canHideGenerations(actor))) {
    Object.assign(filter, STATUS_FILTERS[query.status]);
  }

  const q = query.q?.trim().slice(0, 100);
  if (q) filter.prompt = { $regex: escapeRegex(q), $options: "i" };

  if (query.provider) Object.assign(filter, providerMatch(query.provider));

  if (query.createdFrom || query.createdTo) {
    filter.createdAt = {
      ...(query.createdFrom && { $gte: query.createdFrom }),
      ...(query.createdTo && { $lt: query.createdTo }),
    };
  }

  const collection = await generationsCollection();

  const withOptions = query.withOptions ?? true;

  const [docs, total, projects, users, models] = await Promise.all([
    collection
      .find(filter, { projection: LIST_PROJECTION })
      // _id breaks ties so pages never overlap or skip
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(filter),
    withOptions
      ? collection
          .aggregate<{ _id: string; name: string }>([
            // Newest first, so a renamed project shows its
            // current name
            { $match: scope },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$projectId", name: { $first: "$projectName" } } },
            { $sort: { name: 1 } },
          ])
          .toArray()
      : Promise.resolve([]),
    withOptions && canManageUsers(actor)
      ? collection
          .aggregate<{ _id: string; name: string }>([
            { $match: scope },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$userId", name: { $first: "$userName" } } },
            { $sort: { name: 1 } },
          ])
          .toArray()
      : Promise.resolve([]),
    withOptions ? collection.distinct("model", scope) : Promise.resolve([]),
  ]);

  // Show today's names after a rename
  const names = await currentNames(
    [...docs.map((doc) => doc.projectId), ...projects.map((item) => item._id)],
    [...docs.map((doc) => doc.userId), ...users.map((item) => item._id)]
  );

  const named = (list: { _id: string; name: string }[], map: Map<string, string>) =>
    list
      .map((item) => ({ id: item._id, name: map.get(item._id) ?? item.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generations: docs.map((doc) => ({
      ...toPublicGeneration(doc),
      project: names.projects.get(doc.projectId) ?? doc.projectName,
      user: names.users.get(doc.userId) ?? doc.userName,
    })),
    total,
    page,
    pageSize,
    ...(withOptions && {
      options: {
        projects: named(projects, names.projects),
        users: named(users, names.users),
        models: (models as string[]).sort(),
      },
    }),
  };
}

// One generation with the inputs it ran with, for
// "Run again". Null when missing or not the viewer's.
export async function getGenerationForViewer(
  actor: StoredUser,
  id: string
): Promise<(PublicGeneration & { inputs: Record<string, unknown> }) | null> {
  const doc = await getGeneration(id);

  if (!doc || !canViewGeneration(actor, doc)) return null;

  return { ...toPublicGeneration(doc), inputs: doc.inputs ?? {} };
}

// --------------------------------------------------
// REPLICATE SYNC
// --------------------------------------------------

export async function fetchPrediction(
  id: string
): Promise<
  | { ok: true; prediction: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const headers = replicateHeaders({ Accept: "application/json" });

  if (!headers) {
    return {
      ok: false,
      status: 500,
      error: "REPLICATE_API_TOKEN is missing",
    };
  }

  const response = await fetch(
    replicateApiUrl(`predictions/${encodeURIComponent(id)}`),
    { headers, cache: "no-store" }
  );

  const data = await readReplicateJson(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: replicateErrorMessage(data, "Failed to fetch prediction"),
    };
  }

  return { ok: true, prediction: data };
}

// The run's current state from whichever provider ran
// it, in Replicate's shape (see lib/higgsfield/client.ts)
export function fetchGenerationStatus(
  generation: Pick<
    GenerationDoc,
    "_id" | "provider" | "status" | "createdAt" | "localOutputUrl" | "error" | "predictTime"
  >
): ReturnType<typeof fetchPrediction> {
  if (generation.provider === "elevenlabs") return Promise.resolve(localRunStatus(generation));

  return generation.provider === "higgsfield"
    ? checkHiggsfieldRequest(generation._id)
    : fetchPrediction(generation._id);
}

// --------------------------------------------------
// RUNS DONE HERE (ElevenLabs)
//
// ElevenLabs answers with the audio itself, so the server
// does the whole run (app/api/elevenlabs/generate) and
// finishes the record with finishLocalRun; polling reads
// the record. A run whose server work died is failed
// after LOCAL_RUN_STALE_MS, so it can't stay "running".
// --------------------------------------------------

const LOCAL_RUN_STALE_MS = 15 * 60 * 1000;

function localRunStatus(
  generation: Pick<GenerationDoc, "_id" | "status" | "createdAt" | "localOutputUrl" | "error" | "predictTime">
): { ok: true; prediction: Record<string, unknown> } {
  const stale =
    !isTerminalStatus(generation.status) &&
    Date.now() - new Date(generation.createdAt).getTime() > LOCAL_RUN_STALE_MS;

  return {
    ok: true,
    prediction: {
      id: generation._id,
      status: stale ? "failed" : generation.status,
      output: generation.localOutputUrl ? [generation.localOutputUrl] : null,
      error: stale ? "The run stopped before finishing. Please try again." : generation.error,
      metrics: generation.predictTime === null ? {} : { predict_time: generation.predictTime },
    },
  };
}

export async function finishLocalRun(
  generationId: string,
  result:
    | { ok: true; bytes: Buffer; contentType: string; costUsd: number | null; seconds: number }
    | { ok: false; error: string; seconds: number }
): Promise<void> {
  const generations = await generationsCollection();
  const now = new Date();

  if (!result.ok) {
    await generations.updateOne(
      { _id: generationId, status: { $nin: [...TERMINAL_STATUSES] } },
      {
        $set: {
          status: "failed",
          error: result.error.slice(0, 2000),
          predictTime: result.seconds,
          completedAt: now,
          updatedAt: now,
        },
      }
    );
    return;
  }

  const saved = await saveOutputBytes(generationId, result.bytes, result.contentType);
  if (!saved) {
    await finishLocalRun(generationId, { ok: false, error: "Couldn't save the result.", seconds: result.seconds });
    return;
  }

  const updated = await generations.findOneAndUpdate(
    { _id: generationId, status: { $nin: [...TERMINAL_STATUSES] } },
    {
      $set: {
        status: "succeeded",
        costUsd: result.costUsd,
        localOutputUrl: outputUrlFor(generationId),
        outputFileId: saved.fileId,
        outputBlobUrl: saved.blobUrl,
        outputContentType: saved.contentType,
        outputSize: saved.size,
        predictTime: result.seconds,
        completedAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  // Already finished (or failed as stale) meanwhile
  if (!updated) {
    await deleteSavedOutput(saved);
    return;
  }

  await recordExpense(updated, result.costUsd, now);
}

// Longest a save may hold its claim (download timeout is
// 5 minutes, plus the upload)
const SAVE_CLAIM_MS = 15 * 60 * 1000;

// Store what Replicate told us about a prediction.
// Cost is computed from the model stored at creation,
// never from anything the client sends.
//
// Safe to call concurrently (browser polling and the
// history reconcile can race): a finished record is
// never overwritten, and the expense write is
// idempotent.
export async function applyPrediction(
  generation: GenerationDoc,
  prediction: Record<string, unknown>
): Promise<{
  costUsd: number | null;
  localOutputUrl: string | null;
}> {
  const status = String(prediction.status ?? "");
  const terminal = isTerminalStatus(status);

  // Already final. Make sure a succeeded run is billed
  // (the expense write may have failed last time), but
  // change nothing else.
  if (isTerminalStatus(generation.status)) {
    if (generation.status === "succeeded") {
      await recordExpense(
        generation,
        generation.costUsd,
        generation.completedAt ?? generation.updatedAt
      );
    }

    return {
      costUsd: generation.costUsd,
      localOutputUrl: generation.localOutputUrl,
    };
  }

  const set: Partial<GenerationDoc> = {
    status,
    updatedAt: new Date(),
  };

  let costUsd: number | null = null;
  let localOutputUrl: string | null = null;
  let saved: SavedOutput | null = null;

  if (terminal && (generation.provider ?? "replicate") === "replicate") {
    try {
      // Price from Replicate's echoed input over the inputs
      // we stored: Replicate drops inputs after a while,
      // and the tiers (resolution, duration) must survive.
      const echoed = prediction.input as Record<string, unknown> | undefined;

      costUsd = calculateReplicateCost(generation.model, {
        ...prediction,
        input: { ...(generation.inputs ?? {}), ...(echoed ?? {}) },
      });
    } catch (costError) {
      console.error("Cost calculation error:", costError);
    }
  }

  if (terminal) {
    const replicateUrl = firstUrl(prediction.output);

    if (status === "succeeded" && replicateUrl) {
      // One saver at a time: copying a large output takes a
      // while, and parallel polls would each copy it again.
      // The claim expires, so a crashed saver can't block it.
      const now = new Date();
      const claim = await (await generationsCollection()).updateOne(
        {
          _id: generation._id,
          status: { $nin: [...TERMINAL_STATUSES] },
          $or: [
            { outputSavingUntil: { $exists: false } },
            { outputSavingUntil: null },
            { outputSavingUntil: { $lt: now } },
          ],
        },
        { $set: { outputSavingUntil: new Date(now.getTime() + SAVE_CLAIM_MS) } }
      );

      if (!claim.modifiedCount) {
        // Another request is saving (or just finished) it
        const current = await getGeneration(generation._id);

        return {
          costUsd: current?.costUsd ?? null,
          localOutputUrl: current?.localOutputUrl ?? null,
        };
      }

      if (generation.provider === "higgsfield") {
        // Higgsfield bills what the run produced (or its
        // quote): measured once, by the claim holder, while
        // the output is saved
        let cost: number | null;
        [saved, cost] = await Promise.all([
          saveOutput(generation._id, replicateUrl, isHiggsfieldOutputUrl),
          higgsfieldRunCostUsd(generation, replicateUrl).catch((costError) => {
            console.error("Cost calculation error:", costError);
            return null;
          }),
        ]);
        costUsd = cost;
      } else {
        saved = await saveOutput(generation._id, replicateUrl);
      }
      localOutputUrl = saved ? outputUrlFor(generation._id) : null;
    }

    const metrics = prediction.metrics as
      | { predict_time?: number }
      | undefined;

    set.costUsd = costUsd;
    set.outputUrl = firstUrl(prediction.output);
    set.localOutputUrl = localOutputUrl;
    set.outputFileId = saved?.fileId ?? null;
    set.outputBlobUrl = saved?.blobUrl ?? null;
    set.outputContentType = saved?.contentType ?? null;
    set.outputSize = saved?.size ?? null;
    set.outputSavingUntil = null;
    set.error =
      typeof prediction.error === "string"
        ? prediction.error.slice(0, 2000)
        : null;
    set.predictTime =
      typeof metrics?.predict_time === "number"
        ? metrics.predict_time
        : null;
    set.completedAt = new Date();
  }

  // Only a still-running record may change: if another
  // request finished it meanwhile, keep that result.
  const updated = await (await generationsCollection()).findOneAndUpdate(
    { _id: generation._id, status: { $nin: [...TERMINAL_STATUSES] } },
    { $set: set },
    { returnDocument: "after" }
  );

  if (!updated) {
    // Another request finished it first; its copy wins
    await deleteSavedOutput(saved);

    const current = await getGeneration(generation._id);

    return {
      costUsd: current?.costUsd ?? null,
      localOutputUrl: current?.localOutputUrl ?? null,
    };
  }

  // Bill succeeded generations in the expense ledger
  // (insert-only, so repeated polls can't double-count)
  if (status === "succeeded") {
    await recordExpense(updated, costUsd, set.completedAt ?? new Date());
  }

  return { costUsd, localOutputUrl };
}

const MAX_RECONCILE_FAILURES = 5;

// Finish records whose browser tab closed before the
// prediction completed. Bounded so a page load stays fast.
export async function reconcilePending(
  actor: StoredUser,
  limit = 10
) {
  const olderThan = new Date(Date.now() - 15_000);

  const collection = await generationsCollection();

  const pending = await collection
    .find({
      status: { $nin: [...TERMINAL_STATUSES] },
      createdAt: { $lt: olderThan },
      // Predictions Replicate can't find are given up on
      // after a few tries, so they can't block the rest
      reconcileFailures: { $not: { $gte: MAX_RECONCILE_FAILURES } },
      ...(canManageUsers(actor) ? {} : { userId: actor.id }),
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  await Promise.allSettled(
    pending.map(async (generation) => {
      const result = await fetchGenerationStatus(generation);

      if (result.ok) {
        await applyPrediction(generation, result.prediction);
        return;
      }

      // Not found / gone: count it, and after the last
      // try record it as unknown instead of retrying forever
      if (result.status === 404 || result.status === 410) {
        const failures = (generation.reconcileFailures ?? 0) + 1;

        await collection.updateOne(
          { _id: generation._id, status: { $nin: [...TERMINAL_STATUSES] } },
          {
            $set: {
              reconcileFailures: failures,
              updatedAt: new Date(),
              ...(failures >= MAX_RECONCILE_FAILURES
                ? {
                    status: "unknown",
                    error: `${providerName(generation.provider)} no longer has this run.`,
                    completedAt: new Date(),
                  }
                : {}),
            },
          }
        );
      }
    })
  );
}

// --------------------------------------------------
// DELETE (super admin only, checked by the route)
//
// Removes a finished run everywhere: History, its saved
// output, and its expense (so Dashboard and Expenses no
// longer count it). A run still going can't be deleted,
// since finishing it is what records its cost.
// --------------------------------------------------

export type DeleteGenerationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function deleteGeneration(id: string): Promise<DeleteGenerationResult> {
  const generations = await generationsCollection();

  const doc = await generations.findOneAndDelete({
    _id: id,
    status: { $in: [...TERMINAL_STATUSES] },
  });

  if (!doc) {
    const exists = await generations.countDocuments({ _id: id }, { limit: 1 });

    return exists
      ? { ok: false, status: 409, error: "This run is still going. Delete it once it has finished." }
      : { ok: false, status: 404, error: "Generation not found" };
  }

  // After the record is gone, so nothing points at a
  // deleted file (a copy still being saved is caught by
  // the outputs/ sweep). The expense shares the run's id.
  await Promise.all([
    deleteSavedOutput({
      fileId: doc.outputFileId ?? null,
      blobUrl: doc.outputBlobUrl ?? null,
    }),
    (await expensesCollection()).deleteOne({ _id: id }),
  ]);

  return { ok: true };
}

// --------------------------------------------------
// HIDE (super admin only, checked by the route)
//
// A hidden run disappears for everyone else: History,
// its detail and its output file. Only finished runs, so
// the person who started one can still watch it finish.
// --------------------------------------------------

export async function setGenerationHidden(
  id: string,
  hidden: boolean
): Promise<{ ok: true; hidden: boolean } | { ok: false; status: number; error: string }> {
  const generations = await generationsCollection();

  const result = await generations.updateOne(
    { _id: id, status: { $in: [...TERMINAL_STATUSES] } },
    { $set: { hiddenAt: hidden ? new Date() : null } }
  );

  if (!result.matchedCount) {
    const exists = await generations.countDocuments({ _id: id }, { limit: 1 });

    return exists
      ? { ok: false, status: 409, error: "This run is still going. Hide it once it has finished." }
      : { ok: false, status: 404, error: "Generation not found" };
  }

  return { ok: true, hidden };
}

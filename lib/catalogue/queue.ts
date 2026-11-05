import { finishLocalRun } from "@/lib/generations";
import { generationsCollection, isDuplicateKeyError } from "@/lib/db/mongodb";
import { catalogueCollections, type JobDoc } from "./db";
import { CALL_TIMEOUT_MS, DirectError, generateDirect } from "./direct";

// --------------------------------------------------
// CATALOGUE: the queue for direct (Google / OpenAI)
// image calls, as the original's AI service limits them:
//
// - at most CALL_SLOTS calls in flight across every server
//   (AI_SERVICE_MAX_CONCURRENT = 4), and PER_PRODUCT for
//   one product (RDA_SHOT_CONCURRENCY = 3);
// - a call that fails with a retryable answer is queued
//   again once (AI_SERVICE_GENERATE_RETRY_COUNT = 1, after
//   1.5 s), never one whose outcome is unknown;
// - a call whose server died (lease ran out) is failed,
//   not sent again (the original's PROVIDER_OUTCOME_UNKNOWN).
//
// Jobs are MongoDB docs (catalogueJobs) and slots are
// docs taken atomically (catalogueSlots), so this holds
// across serverless instances. pumpQueue() runs after a
// response (starting a run, and every product poll) and
// only takes a job it can finish within one function's
// time (maxDuration 300 s).
// --------------------------------------------------

export const CALL_SLOTS = 4;
export const PER_PRODUCT = 3;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;
// One function's time, less a margin for saving the image
const FUNCTION_BUDGET_MS = 290_000;
const SAVE_MARGIN_MS = 8_000;
const LEASE_EXTRA_MS = 30_000;

export type QueuedJob = Pick<JobDoc, "_id" | "productId" | "engine" | "request">;
const ENGINES = ["google", "openai"] as const;

type Job = JobDoc;

export async function enqueueJob(job: QueuedJob): Promise<void> {
  const { jobs } = await catalogueCollections();
  await jobs.insertOne({
    ...job,
    status: "queued",
    slot: null,
    leaseUntil: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
  });
}

let slotsReady: Promise<unknown> | null = null;
async function ensureSlots() {
  const { slots } = await catalogueCollections();
  slotsReady ??= Promise.all(
    Array.from({ length: CALL_SLOTS }, (_, id) =>
      slots.updateOne({ _id: id }, { $setOnInsert: { jobId: null, leaseUntil: new Date(0) } }, { upsert: true }),
    ),
  ).catch((error) => {
    slotsReady = null;
    throw error;
  });
  await slotsReady;
}

// Running jobs whose server stopped: their outcome is
// unknown, so they fail rather than being sent again
async function failLostJobs(): Promise<void> {
  const { jobs, slots } = await catalogueCollections();
  const now = new Date();
  const lost = await jobs.find({ status: "running", leaseUntil: { $lt: now } }).limit(50).toArray();
  for (const job of lost) {
    const claimed = await jobs.updateOne(
      { _id: job._id, status: "running", leaseUntil: { $lt: now } },
      { $set: { status: "done", finishedAt: now, slot: null } },
    );
    if (!claimed.modifiedCount) continue;
    if (job.slot !== null) await slots.updateOne({ _id: job.slot, jobId: job._id }, { $set: { jobId: null, leaseUntil: new Date(0) } });
    await releaseProduct(job.productId);
    await finishLocalRun(job._id, {
      ok: false,
      error: "The image run was interrupted before it finished. Try again.",
      seconds: job.startedAt ? Math.round((now.getTime() - job.startedAt.getTime()) / 1000) : 0,
    });
  }
}

// Product counts left high by a server that stopped
// between reserving and starting: back to the truth
async function fixProductCounts(): Promise<void> {
  const { jobs, productSlots } = await catalogueCollections();
  // Only counts untouched for a minute (not one being
  // reserved right now)
  const settled = new Date(Date.now() - 60_000);
  const counted = await productSlots.find({ count: { $gt: 0 }, updatedAt: { $lt: settled } }).limit(200).toArray();
  for (const entry of counted) {
    const running = await jobs.countDocuments({ productId: entry._id, status: "running" });
    if (running < entry.count) await productSlots.updateOne({ _id: entry._id, count: entry.count }, { $set: { count: running } });
  }
}

// One more call in flight for a product, if it's under
// PER_PRODUCT (atomic: the filter only matches below the
// limit; at the limit the upsert collides with the doc)
async function reserveProduct(productId: string | null): Promise<boolean> {
  if (!productId) return true;
  const { productSlots } = await catalogueCollections();
  try {
    await productSlots.updateOne(
      { _id: productId, count: { $lt: PER_PRODUCT } },
      { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

async function releaseProduct(productId: string | null): Promise<void> {
  if (!productId) return;
  const { productSlots } = await catalogueCollections();
  await productSlots.updateOne({ _id: productId, count: { $gt: 0 } }, { $inc: { count: -1 }, $set: { updatedAt: new Date() } });
}

// Takes a free slot, then the oldest job that can start
// (its product is under PER_PRODUCT and it fits the time
// left); gives the slot back if there's none
async function claim(timeLeftMs: number): Promise<Job | null> {
  const { jobs, slots } = await catalogueCollections();
  const now = new Date();
  const engines = ENGINES.filter(
    (engine) => CALL_TIMEOUT_MS[engine] + SAVE_MARGIN_MS <= timeLeftMs,
  );
  if (!engines.length) return null;

  const busy = await jobs
    .aggregate<{ _id: string; count: number }>([
      { $match: { status: "running", productId: { $ne: null } } },
      { $group: { _id: "$productId", count: { $sum: 1 } } },
      { $match: { count: { $gte: PER_PRODUCT } } },
    ])
    .toArray();
  const candidate = await jobs.findOne(
    {
      status: "queued",
      engine: { $in: engines },
      productId: { $nin: busy.map((item) => item._id) },
      $or: [{ notBefore: null }, { notBefore: { $exists: false } }, { notBefore: { $lte: now } }],
    },
    { sort: { createdAt: 1 } },
  );
  if (!candidate) return null;

  if (!(await reserveProduct(candidate.productId))) return null;
  const lease = new Date(now.getTime() + CALL_TIMEOUT_MS[candidate.engine] + LEASE_EXTRA_MS);
  const slot = await slots.findOneAndUpdate(
    { leaseUntil: { $lt: now } },
    { $set: { jobId: candidate._id, leaseUntil: lease } },
  );
  if (!slot) {
    await releaseProduct(candidate.productId);
    return null;
  }

  const job = await jobs.findOneAndUpdate(
    { _id: candidate._id, status: "queued" },
    { $set: { status: "running", slot: slot._id, leaseUntil: lease, startedAt: now } },
    { returnDocument: "after" },
  );
  if (!job) {
    await slots.updateOne({ _id: slot._id, jobId: candidate._id }, { $set: { jobId: null, leaseUntil: new Date(0) } });
    await releaseProduct(candidate.productId);
    return null;
  }
  // The run's clock starts now (History's stale check)
  await (await generationsCollection()).updateOne({ _id: job._id }, { $set: { createdAt: now } });
  const { runs } = await catalogueCollections();
  await runs.updateOne({ _id: job._id }, { $set: { startedAt: now } });
  return job;
}

async function release(job: Job, update: Partial<Job>): Promise<void> {
  const { jobs, slots } = await catalogueCollections();
  await jobs.updateOne({ _id: job._id }, { $set: { ...update, slot: null, leaseUntil: null } });
  if (job.slot !== null) await slots.updateOne({ _id: job.slot, jobId: job._id }, { $set: { jobId: null, leaseUntil: new Date(0) } });
  await releaseProduct(job.productId);
}

async function runJob(job: Job): Promise<void> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  try {
    const result = await generateDirect(job.engine, job.request);
    await release(job, { status: "done", finishedAt: new Date() });
    await finishLocalRun(job._id, { ok: true, ...result, seconds: seconds() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image model failed";
    const attempts = (job.attempts ?? 1) + 1;
    if (error instanceof DirectError && error.retryable && attempts <= MAX_ATTEMPTS) {
      console.warn(`Catalogue ${job.engine} call failed, queued again:`, job._id, message);
      await release(job, { status: "queued", attempts, notBefore: new Date(Date.now() + RETRY_DELAY_MS) });
      return;
    }
    console.error(`Catalogue ${job.engine} run failed:`, job._id, message);
    await release(job, { status: "done", finishedAt: new Date() });
    await finishLocalRun(job._id, { ok: false, error: message, seconds: seconds() }).catch((finishError) =>
      console.error("Catalogue: couldn't record the failure:", job._id, finishError),
    );
  }
}

// Works through the queue for as long as this function
// has time: up to CALL_SLOTS calls at once
export async function pumpQueue(): Promise<void> {
  const began = Date.now();
  try {
    await ensureSlots();
    await failLostJobs();
    await fixProductCounts();
    const running = new Set<Promise<void>>();
    for (;;) {
      const job = await claim(FUNCTION_BUDGET_MS - (Date.now() - began));
      if (job) {
        const work = runJob(job).finally(() => running.delete(work));
        running.add(work);
        continue;
      }
      if (!running.size) break;
      // A finished call may free a slot (or a retry may be
      // due): look again
      await Promise.race([...running, new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS + 100))]);
    }
  } catch (error) {
    console.error("Catalogue queue error:", error);
  }
}

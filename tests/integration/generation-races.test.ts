import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { GenerationDoc } from "@/lib/db/mongodb";

// --------------------------------------------------
// Race conditions in the generation bookkeeping, driven
// through the library directly so the interleaving is
// exact (two requests that both read "processing").
// Uses its own database on the shared in-memory server.
// --------------------------------------------------

process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = "naar_lib_races";
process.env.REPLICATE_API_URL = `${inject("replicateUrl")}/v1`;
process.env.REPLICATE_API_TOKEN = "test-token";

let lib: typeof import("@/lib/generations");
let mongo: typeof import("@/lib/db/mongodb");

beforeAll(async () => {
  lib = await import("@/lib/generations");
  mongo = await import("@/lib/db/mongodb");
});

afterAll(async () => {
  const client = await (globalThis as { mongoClientPromise?: Promise<{ close(): Promise<void> }> })
    .mongoClientPromise;
  await client?.close();
});

let counter = 0;

async function insertRunning(overrides: Partial<GenerationDoc> = {}): Promise<GenerationDoc> {
  const now = new Date();
  const doc: GenerationDoc = {
    _id: `test-race-${Date.now()}-${++counter}`,
    userId: "u1",
    userName: "User",
    projectId: "p1",
    projectName: "Project",
    provider: "replicate",
    model: "google/nano-banana",
    version: "v1",
    prompt: "x",
    inputs: { prompt: "x" },
    inputImage: null,
    aspectRatio: "",
    resolution: "",
    status: "processing",
    error: null,
    costUsd: null,
    outputUrl: null,
    localOutputUrl: null,
    predictTime: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };

  await (await mongo.generationsCollection()).insertOne(doc);
  return doc;
}

const read = async (id: string) =>
  (await mongo.generationsCollection()).findOne({ _id: id });

describe("applyPrediction under concurrency", () => {
  it("a slow 'processing' write can't overwrite a finished run", async () => {
    // Both requests read the record while it was running
    const staleCopy = await insertRunning();

    await lib.applyPrediction(staleCopy, {
      status: "succeeded",
      output: [`${inject("replicateUrl")}/__control/output.png`],
    });

    // The slower request lands afterwards with old news
    await lib.applyPrediction(staleCopy, { status: "processing" });

    expect(await read(staleCopy._id)).toMatchObject({
      status: "succeeded",
      costUsd: 0.039,
    });
  });

  it("two finishing writes bill once and keep one saved copy", async () => {
    const staleCopy = await insertRunning();
    const output = [`${inject("replicateUrl")}/__control/output.png`];

    await Promise.all([
      lib.applyPrediction(staleCopy, { status: "succeeded", output }),
      lib.applyPrediction(staleCopy, { status: "succeeded", output }),
      lib.applyPrediction(staleCopy, { status: "succeeded", output }),
    ]);

    // The losers' copies are deleted, not orphaned
    const files = await (await mongo.generationOutputsBucket())
      .find({ filename: staleCopy._id })
      .toArray();
    expect(files).toHaveLength(1);
    expect((await read(staleCopy._id))?.outputFileId).toEqual(files[0]._id);

    const expenses = await (await mongo.expensesCollection())
      .find({ _id: staleCopy._id })
      .toArray();

    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountUsd).toBe(0.039);
  });

  it("prices from stored inputs when Replicate has dropped them", async () => {
    const doc = await insertRunning({
      model: "google/nano-banana-2",
      inputs: { prompt: "x", resolution: "4K" },
    });

    // Replicate returns an empty input object for old runs
    await lib.applyPrediction(doc, { status: "succeeded", input: {}, output: [] });

    expect((await read(doc._id))?.costUsd).toBe(0.151);
  });
});

describe("reconcilePending", () => {
  const manager = {
    id: "m",
    username: "m",
    name: "M",
    role: "super_admin" as const,
    disabled: false,
    sessionVersion: 0,
    passwordHash: "",
    createdAt: "",
    updatedAt: "",
  };

  it("gives up on predictions Replicate no longer has", async () => {
    const lost = await insertRunning({
      _id: `test-lost-${Date.now()}`,
      createdAt: new Date(Date.now() - 60_000),
    });

    for (let i = 0; i < 6; i++) await lib.reconcilePending(manager);

    expect(await read(lost._id)).toMatchObject({
      status: "unknown",
      reconcileFailures: 5,
    });

    // And it's no longer retried
    await lib.reconcilePending(manager);
    expect((await read(lost._id))?.reconcileFailures).toBe(5);
  });
});

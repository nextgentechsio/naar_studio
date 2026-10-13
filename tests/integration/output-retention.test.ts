import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { GridFSBucket, ObjectId, type MongoClient } from "mongodb";
import {
  api,
  baseUrl,
  closeDb,
  createProject,
  createUser,
  db,
  fakeOutputUrl,
  loginRoot,
  setPrediction,
  startGeneration,
  type Session,
} from "./helpers";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";

// --------------------------------------------------
// Saved outputs (Blob, or GridFS for older records)
// older than 7 days are deleted; the generation record
// and its expense are kept.
// --------------------------------------------------

// Point the app's DB layer (imported below) at the test DB
process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = inject("dbName");
process.env.BLOB_READ_WRITE_TOKEN = FAKE_BLOB_TOKEN;
process.env.VERCEL_BLOB_API_URL = `${inject("replicateUrl")}/blob`;

const DAY = 24 * 60 * 60 * 1000;

let root: Session;
let user: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  root = await loginRoot();
  user = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(async () => {
  const cached = (globalThis as { mongoClientPromise?: Promise<MongoClient> })
    .mongoClientPromise;
  await (await cached)?.close();
  await closeDb();
});

async function finishedRun() {
  const id = await startGeneration(user.session, project.name);
  await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
  await api(`/api/predictions/${encodeURIComponent(id)}`, { session: user.session });

  const record = await (await db()).collection("generations").findOne({ _id: id as never });
  // New outputs go to Blob (the test env has a Blob token)
  expect(record?.outputBlobUrl).toBeTruthy();
  expect(record?.outputFileId).toBeNull();
  return { id, blobUrl: record!.outputBlobUrl as string };
}

async function ageRecord(id: string, days: number) {
  await (await db())
    .collection("generations")
    .updateOne({ _id: id as never }, { $set: { completedAt: new Date(Date.now() - days * DAY) } });
}

const blobExists = async (url: string) => (await fetch(url)).status === 200;

const outputStatus = async (id: string) =>
  (
    await fetch(`${baseUrl}/api/generations/${id}/output`, {
      headers: { cookie: user.session.cookie },
    })
  ).status;

describe("output retention", () => {
  it("deletes Blob outputs older than 7 days and keeps the records", async () => {
    const { pruneExpiredOutputs } = await import("@/lib/output-retention");

    const old = await finishedRun();
    const recent = await finishedRun();
    await ageRecord(old.id, 8);
    await ageRecord(recent.id, 6);

    expect(await blobExists(old.blobUrl)).toBe(true);
    expect(await pruneExpiredOutputs()).toBeGreaterThanOrEqual(1);

    const database = await db();

    // The file is gone from Blob
    expect(await blobExists(old.blobUrl)).toBe(false);

    // Record and expense are kept, marked expired
    const record = await database.collection("generations").findOne({ _id: old.id as never });
    expect(record).toMatchObject({ status: "succeeded", outputBlobUrl: null, localOutputUrl: null });
    expect(record?.outputExpiredAt).toBeInstanceOf(Date);
    expect(await database.collection("expenses").countDocuments({ _id: old.id as never })).toBe(1);

    const detail = await api(`/api/generations/${old.id}`, { session: user.session });
    expect(detail.data).toMatchObject({ generation: { outputUrl: null, outputExpired: true } });
    expect(await outputStatus(old.id)).toBe(404);

    // 6 days old: untouched
    expect(await blobExists(recent.blobUrl)).toBe(true);
    expect(await outputStatus(recent.id)).toBe(200);

    // Running again finds nothing new
    expect(await pruneExpiredOutputs()).toBe(0);
  });

  it("also deletes older GridFS outputs (records from before Blob)", async () => {
    const { pruneExpiredOutputs } = await import("@/lib/output-retention");
    const database = await db();

    // A record as the app wrote them before Blob: file in GridFS
    const { id } = await finishedRun();
    const bucket = new GridFSBucket(database, { bucketName: "generationOutputs" });
    const fileId = new ObjectId();
    await new Promise<void>((resolve, reject) => {
      const upload = bucket.openUploadStream(id, { id: fileId, metadata: { generationId: id, contentType: "image/png" } });
      upload.once("finish", () => resolve());
      upload.once("error", reject);
      upload.end(Buffer.from("legacy"));
    });
    await database.collection("generations").updateOne(
      { _id: id as never },
      { $set: { outputBlobUrl: null, outputFileId: fileId, outputSize: 6 } }
    );
    expect(await outputStatus(id)).toBe(200);

    await ageRecord(id, 8);
    expect(await pruneExpiredOutputs()).toBeGreaterThanOrEqual(1);

    expect(await database.collection("generationOutputs.files").countDocuments({ _id: fileId })).toBe(0);
    expect(await database.collection("generationOutputs.chunks").countDocuments({ files_id: fileId })).toBe(0);
    expect(await outputStatus(id)).toBe(404);
  });
});

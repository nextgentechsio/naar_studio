import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { MongoClient } from "mongodb";
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

// --------------------------------------------------
// Saved outputs older than 7 days are deleted; the
// generation record and its expense are kept.
// --------------------------------------------------

// Point the app's DB layer (imported below) at the test DB
process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = inject("dbName");

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
  expect(record?.outputFileId).toBeTruthy();
  return { id, fileId: record!.outputFileId };
}

async function ageFile(fileId: unknown, days: number) {
  await (await db())
    .collection("generationOutputs.files")
    .updateOne({ _id: fileId as never }, { $set: { uploadDate: new Date(Date.now() - days * DAY) } });
}

describe("output retention", () => {
  it("deletes outputs older than 7 days and keeps the records", async () => {
    const { pruneExpiredOutputs } = await import("@/lib/output-retention");

    const old = await finishedRun();
    const recent = await finishedRun();
    await ageFile(old.fileId, 8);
    await ageFile(recent.fileId, 6);

    expect(await pruneExpiredOutputs()).toBeGreaterThanOrEqual(1);

    const database = await db();

    // File and all its chunks are gone
    expect(await database.collection("generationOutputs.files").countDocuments({ _id: old.fileId })).toBe(0);
    expect(await database.collection("generationOutputs.chunks").countDocuments({ files_id: old.fileId })).toBe(0);

    // Record and expense are kept, marked expired
    const record = await database.collection("generations").findOne({ _id: old.id as never });
    expect(record).toMatchObject({ status: "succeeded", outputFileId: null, localOutputUrl: null });
    expect(record?.outputExpiredAt).toBeInstanceOf(Date);
    expect(await database.collection("expenses").countDocuments({ _id: old.id as never })).toBe(1);

    const detail = await api(`/api/generations/${old.id}`, { session: user.session });
    expect(detail.data).toMatchObject({ generation: { outputUrl: null, outputExpired: true } });

    const served = await fetch(`${baseUrl}/api/generations/${old.id}/output`, {
      headers: { cookie: user.session.cookie },
    });
    expect(served.status).toBe(404);

    // 6 days old: untouched
    const kept = await fetch(`${baseUrl}/api/generations/${recent.id}/output`, {
      headers: { cookie: user.session.cookie },
    });
    expect(kept.status).toBe(200);
    const keptDetail = await api(`/api/generations/${recent.id}`, { session: user.session });
    expect(keptDetail.data).toMatchObject({ generation: { outputExpired: false } });

    // Running again finds nothing new
    expect(await pruneExpiredOutputs()).toBe(0);
  });
});

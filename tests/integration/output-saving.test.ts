import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { MongoClient } from "mongodb";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import {
  closeDb,
  createProject,
  createUser,
  db,
  fakeOutputUrl,
  loginRoot,
  replicateUrl,
  setPrediction,
  pollPrediction,
  startGeneration,
  type Session,
} from "./helpers";

// --------------------------------------------------
// Saving outputs is robust: a broken download never
// hangs, only Replicate's CDN is fetched (no SSRF),
// parallel polls copy the file once, and stray files
// are swept up by retention.
// --------------------------------------------------

process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB = inject("dbName");
process.env.BLOB_READ_WRITE_TOKEN = FAKE_BLOB_TOKEN;
process.env.VERCEL_BLOB_API_URL = `${inject("replicateUrl")}/blob`;

const DAY = 24 * 60 * 60 * 1000;

let user: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  const root: Session = await loginRoot();
  user = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(async () => {
  const cached = (globalThis as { mongoClientPromise?: Promise<MongoClient> })
    .mongoClientPromise;
  await (await cached)?.close();
  await closeDb();
});

const poll = (id: string) => pollPrediction(user.session, id);

const record = async (id: string) =>
  (await db()).collection("generations").findOne({ _id: id as never });

const blobState = async () =>
  (await (await fetch(`${replicateUrl}/__control/blobs`)).json()) as {
    blobs: { url: string; pathname: string; uploadedAt: string }[];
    requests: { method: string; path: string }[];
  };

async function finishWith(output: string) {
  const id = await startGeneration(user.session, project.name);
  await setPrediction(id, { status: "succeeded", output: [output] });
  return id;
}

describe("saving outputs", () => {
  it.each([
    ["small", 1024 * 1024],
    ["large (streamed in parts)", 60 * 1024 * 1024],
  ])("a %s download that breaks partway fails fast instead of hanging", async (_label, declared) => {
    const id = await finishWith(`${replicateUrl}/__control/broken.png?declared=${declared}`);

    const started = Date.now();
    const { status } = await poll(id);
    expect(status).toBe(200);
    expect(Date.now() - started).toBeLessThan(15_000);

    // Run still finishes (and is billed); just no saved copy
    expect(await record(id)).toMatchObject({
      status: "succeeded",
      outputBlobUrl: null,
      localOutputUrl: null,
      outputSavingUntil: null,
    });
    expect(await (await db()).collection("expenses").countDocuments({ _id: id as never })).toBe(1);
  });

  it("never fetches outputs from hosts other than Replicate (SSRF)", async () => {
    // Same fake server, different origin: reachable, but not allowed
    const other = new URL(fakeOutputUrl());
    other.hostname = "localhost";
    const id = await finishWith(other.toString());

    await poll(id);

    expect(await record(id)).toMatchObject({ status: "succeeded", outputBlobUrl: null });
    const stored = (await blobState()).blobs.filter((b) => b.pathname.startsWith(`outputs/${id}`));
    expect(stored).toHaveLength(0);
  });

  it("copies the output once even when polled many times at once", async () => {
    const id = await finishWith(fakeOutputUrl());

    await Promise.all(Array.from({ length: 6 }, () => poll(id)));

    const saved = await record(id);
    expect(saved?.outputBlobUrl).toBeTruthy();
    expect(saved?.outputSavingUntil).toBeNull();

    // Exactly one stored copy (single or multipart upload)
    const stored = (await blobState()).blobs.filter((b) => b.pathname.startsWith(`outputs/${id}`));
    expect(stored).toHaveLength(1);
    expect(stored[0].url).toBe(saved?.outputBlobUrl);
  });

  it("sweeps stray output files older than 7 days, and only those", async () => {
    const { pruneOldBlobs } = await import("@/lib/input-uploads");
    const state = await blobState();

    const stray = (name: string, days: number) => ({
      url: `${replicateUrl}/blobfiles/${name}`,
      pathname: name,
      size: 1,
      uploadedAt: new Date(Date.now() - days * DAY).toISOString(),
    });

    await fetch(`${replicateUrl}/__control/blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        ...state.blobs,
        stray("outputs/stray-old.png", 8),
        stray("outputs/stray-new.png", 6),
        stray("project-images/keep.png", 30),
      ]),
    });

    expect(await pruneOldBlobs("outputs/")).toBe(1);

    const names = (await blobState()).blobs.map((b) => b.pathname);
    expect(names).not.toContain("outputs/stray-old.png");
    expect(names).toContain("outputs/stray-new.png");
    // Project photos are never swept
    expect(names).toContain("project-images/keep.png");
  });
});

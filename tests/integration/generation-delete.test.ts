import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  closeDb,
  createProject,
  createUser,
  db,
  fakeOutputUrl,
  loginRoot,
  pollPrediction,
  setPrediction,
  startGeneration,
  type Session,
} from "./helpers";

// --------------------------------------------------
// Deleting a run: the super admin only, finished runs
// only. The record, its saved output and its expense go.
// --------------------------------------------------

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let project: { name: string };

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

async function finishedRun() {
  const id = await startGeneration(alice.session, project.name);
  await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
  await pollPrediction(alice.session, id);
  return id;
}

const remove = (session: Session, id: string) =>
  api(`/api/generations/${encodeURIComponent(id)}`, { session, method: "DELETE" });

describe("deleting a run", () => {
  it("is for the super admin only", async () => {
    const id = await finishedRun();

    expect((await remove(alice.session, id)).status).toBe(403);
    expect((await remove(admin.session, id)).status).toBe(403);
    expect((await api(`/api/generations/${id}`, { method: "DELETE" })).status).toBe(401);
    // Still there
    expect((await api(`/api/generations/${id}`, { session: alice.session })).status).toBe(200);
  });

  it("removes the record, its saved output and its expense", async () => {
    const id = await finishedRun();
    const database = await db();
    const before = await database.collection("generations").findOne({ _id: id as never });
    expect(before?.localOutputUrl).toBeTruthy();
    const output = await api(String(before?.localOutputUrl), { session: alice.session });
    expect(output.status).toBe(200);
    const expense = await database.collection("expenses").findOne({ _id: id as never });
    expect(expense).toBeTruthy();

    expect((await remove(root, id)).status).toBe(200);

    expect(await database.collection("generations").findOne({ _id: id as never })).toBeNull();
    expect((await api(`/api/generations/${id}`, { session: alice.session })).status).toBe(404);
    expect((await api(String(before?.localOutputUrl), { session: alice.session })).status).toBe(404);
    // The saved bytes are gone from storage too
    if (before?.outputFileId) {
      expect(await database.collection("generationOutputs.files").findOne({ _id: before.outputFileId })).toBeNull();
    }
    if (before?.outputBlobUrl) {
      expect((await fetch(before.outputBlobUrl)).status).toBe(404);
    }
    // No longer counted in Expenses or the Dashboard
    expect(await database.collection("expenses").findOne({ _id: id as never })).toBeNull();

    // Gone from the list
    const list = await api(`/api/generations?pageSize=100&options=0`, { session: root });
    expect((list.data.generations as { id: string }[]).some((item) => item.id === id)).toBe(false);
  });

  it("refuses runs still going and unknown ids", async () => {
    const running = await startGeneration(alice.session, project.name);
    const result = await remove(root, running);
    expect(result.status).toBe(409);
    expect(String(result.data.error)).toMatch(/still going/);
    expect((await api(`/api/generations/${running}`, { session: alice.session })).status).toBe(200);

    expect((await remove(root, "no-such-run")).status).toBe(404);
  });
});

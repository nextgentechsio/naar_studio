import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  baseUrl,
  closeDb,
  createProject,
  createUser,
  db,
  deletePrediction,
  fakeOutputUrl,
  loginRoot,
  replicateRequests,
  setPrediction,
  startGeneration,
  type Session,
  pollPrediction,
} from "./helpers";

// --------------------------------------------------
// The money path: start a run → poll → succeed →
// expense recorded exactly once, priced from the server's
// table, attributed to the right user and project.
// --------------------------------------------------

let root: Session;
let user: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  root = await loginRoot();
  user = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const poll = (session: Session, id: string) => pollPrediction(session, id);

const expensesFor = async (id: string) =>
  (await db()).collection("expenses").find({ _id: id as never }).toArray();

describe("generate → poll → expense", () => {
  it("records a run and bills it once, at the table price", async () => {
    const id = await startGeneration(user.session, project.name, "google/nano-banana-2", {
      prompt: "a lighthouse",
      resolution: "4K",
    });

    const record = await (await db()).collection("generations").findOne({ _id: id as never });
    expect(record).toMatchObject({
      userId: user.id,
      projectId: project.id,
      model: "google/nano-banana-2",
      status: "starting",
    });

    // Still running: no expense yet
    await setPrediction(id, { status: "processing" });
    expect((await poll(user.session, id)).data.prediction).toMatchObject({ status: "processing" });
    expect(await expensesFor(id)).toHaveLength(0);

    // Finished
    await setPrediction(id, {
      status: "succeeded",
      output: [fakeOutputUrl()],
      metrics: { predict_time: 4.2 },
    });

    const done = await poll(user.session, id);
    expect(done.data.costUsd).toBe(0.151);

    // Polling again (and in parallel) never double-bills
    await Promise.all([poll(user.session, id), poll(user.session, id), poll(root, id)]);

    const expenses = await expensesFor(id);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      amountUsd: 0.151,
      userId: user.id,
      projectId: project.id,
    });

    const saved = await (await db()).collection("generations").findOne({ _id: id as never });
    expect(saved).toMatchObject({ status: "succeeded", costUsd: 0.151, predictTime: 4.2 });
    expect(saved?.localOutputUrl).toBe(`/api/generations/${id}/output`);
  });

  it("serves the saved output to its owner and managers only", async () => {
    const id = await startGeneration(user.session, project.name);
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await poll(user.session, id);

    const original = new Uint8Array(await (await fetch(fakeOutputUrl())).arrayBuffer());
    const url = `${baseUrl}/api/generations/${id}/output`;

    const owner = await fetch(url, { headers: { cookie: user.session.cookie } });
    expect(owner.status).toBe(200);
    expect(owner.headers.get("content-type")).toBe("image/png");
    expect(owner.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await owner.arrayBuffer())).toEqual(original);

    const other = await createUser(root, "user");
    expect((await fetch(url, { headers: { cookie: other.session.cookie } })).status).toBe(404);
    expect((await fetch(url, { headers: { cookie: root.cookie } })).status).toBe(200);
    expect((await fetch(url)).status).toBe(401);

    // Byte ranges (video seeking, Safari playback)
    const partial = await fetch(url, {
      headers: { cookie: user.session.cookie, range: "bytes=2-5" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 2-5/${original.length}`);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(original.slice(2, 6));

    const tail = await fetch(url, { headers: { cookie: user.session.cookie, range: "bytes=-3" } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(original.slice(-3));

    const beyond = await fetch(url, {
      headers: { cookie: user.session.cookie, range: `bytes=${original.length + 10}-` },
    });
    expect(beyond.status).toBe(416);
  });

  it("anyone can run any Replicate model; unlisted ones are billed as unpriced", async () => {
    const { status, data } = await api("/api/generate", {
      session: user.session,
      json: { project: project.name, model: "someone/unlisted", inputs: { prompt: "x" } },
    });
    expect(status).toBe(200);

    const id = (data.tracking as { predictionId: string }).predictionId;
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await poll(user.session, id);

    const expenses = await expensesFor(id);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountUsd).toBeNull();
  });

  it("never lets a stale 'processing' answer undo a finished run", async () => {
    const id = await startGeneration(user.session, project.name);

    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await poll(user.session, id);

    // Replicate (or a slow request) now says "processing"
    await setPrediction(id, { status: "processing", output: null });
    await poll(user.session, id);

    const saved = await (await db()).collection("generations").findOne({ _id: id as never });
    expect(saved?.status).toBe("succeeded");
    expect(saved?.localOutputUrl).toBeTruthy();
    expect(await expensesFor(id)).toHaveLength(1);
  });

  it("re-creates a missing expense for a finished run", async () => {
    const id = await startGeneration(user.session, project.name);
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await poll(user.session, id);

    // Simulate the expense write having failed
    await (await db()).collection("expenses").deleteOne({ _id: id as never });

    await poll(user.session, id);
    expect(await expensesFor(id)).toHaveLength(1);
  });

  it("does not bill failed or canceled runs", async () => {
    for (const status of ["failed", "canceled"]) {
      const id = await startGeneration(user.session, project.name);
      await setPrediction(id, { status, error: "boom" });
      await poll(user.session, id);

      expect(await expensesFor(id)).toHaveLength(0);
      const saved = await (await db()).collection("generations").findOne({ _id: id as never });
      expect(saved).toMatchObject({ status, costUsd: null, error: "boom" });
    }
  });

  it("only the owner (or a manager) can poll a run", async () => {
    const id = await startGeneration(user.session, project.name);
    const other = await createUser(root, "user");

    expect((await poll(other.session, id)).status).toBe(404);
    expect((await poll(root, id)).status).toBe(200);
    expect((await poll(user.session, "made-up-id")).status).toBe(404);
  });

  it("a Replicate outage never looks like the user being signed out", async () => {
    const id = await startGeneration(user.session, project.name);
    await deletePrediction(id);

    const { status } = await poll(user.session, id);
    expect(status).not.toBe(401);
    expect(status).toBe(502);
  });
});

describe("generate validation", () => {
  const generate = (json: unknown, session: Session = user.session) =>
    api("/api/generate", { session, json });

  it("rejects bad bodies, models and projects", async () => {
    const cases: [unknown, number][] = [
      [null, 400],
      [[], 400],
      [{ project: project.name, model: "google/nano-banana" }, 400],
      [{ project: project.name, model: "google/nano-banana", inputs: [] }, 400],
      [{ project: project.name, model: "../account", inputs: {} }, 400],
      [{ project: project.name, model: { $ne: "" }, inputs: {} }, 400],
      [{ project: { $ne: "" }, model: "google/nano-banana", inputs: {} }, 400],
      [{ project: "No such project", model: "google/nano-banana", inputs: {} }, 400],
      [{ project: project.name, model: "google/nano-banana", inputs: { p: "x".repeat(200_000) } }, 400],
    ];

    for (const [json, expected] of cases) {
      const { status } = await generate(json);
      expect(status, JSON.stringify(json).slice(0, 80)).toBe(expected);
    }

    const invalid = await api("/api/generate", {
      session: user.session,
      body: "{oops",
      headers: { "content-type": "application/json" },
    });
    expect(invalid.status).toBe(400);
  });

  it("refuses archived projects", async () => {
    const archived = await createProject(root);
    await api(`/api/projects/${archived.id}`, {
      method: "PATCH",
      session: root,
      json: { status: "archived" },
    });

    const { status, data } = await generate({
      project: archived.name,
      model: "google/nano-banana",
      inputs: { prompt: "x" },
    });
    expect(status).toBe(400);
    expect(data.error).toMatch(/archived/i);
  });

  it("shows Replicate's input errors, and never leaks a 401", async () => {
    const rejected = await generate({
      project: project.name,
      model: "fake/reject",
      inputs: { prompt: "x" },
    }, root);
    expect(rejected.status).toBe(422);
    expect(rejected.data.error).toMatch(/seed must be an integer/);

    const badToken = await generate({
      project: project.name,
      model: "fake/badtoken",
      inputs: { prompt: "x" },
    }, root);
    expect(badToken.status).toBe(502);

    const missing = await generate({
      project: project.name,
      model: "fake/missing",
      inputs: { prompt: "x" },
    }, root);
    expect(missing.status).toBe(404);
  });

  it("shapes inputs to the model's schema before sending", async () => {
    await startGeneration(root, project.name, "fake/shaping", {
      prompt: "x",
      image: ["https://replicate.delivery/a.png"],
      image_input: "https://replicate.delivery/b.png",
      seed: "",
      start_image: ["javascript:alert(1)"],
    });

    const sent = (await replicateRequests())
      .filter((request) => request.path === "/v1/models/fake/shaping/predictions")
      .at(-1)?.body as { input: Record<string, unknown> };

    expect(sent.input).toEqual({
      prompt: "x",
      image: "https://replicate.delivery/a.png",
      image_input: ["https://replicate.delivery/b.png"],
    });
  });

  it("attributes spend to the signed-in user, whatever the body says", async () => {
    const { data } = await generate({
      project: project.name,
      model: "google/nano-banana",
      inputs: { prompt: "x" },
      user: "someone-else",
      userId: "admin",
    });

    const id = (data.tracking as { predictionId: string }).predictionId;
    const record = await (await db()).collection("generations").findOne({ _id: id as never });
    expect(record?.userId).toBe(user.id);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  baseUrl,
  closeDb,
  createProject,
  createUser,
  db,
  loginRoot,
  replicateRequests,
  replicateUrl,
  type Session,
} from "./helpers";

// --------------------------------------------------
// Higgsfield runs against the fake API under /hf: the
// model list and settings, start, poll to a result, save
// it, bill it, and every way a run can end badly.
// --------------------------------------------------

const SEEDANCE = "bytedance/seedance-2.5/text-to-video";
const SOUL = "higgsfield-ai/soul/v2/image-to-image";

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const VALID = {
  prompt: "A cinematic scene at sunset",
  duration: 5,
  resolution: "720p",
  aspect_ratio: "16:9",
  generate_audio: true,
};

const start = (
  session: Session | null,
  inputs: Record<string, unknown> = VALID,
  projectName = project.name,
  model = SEEDANCE
) => api("/api/higgsfield/generate", { session, json: { project: projectName, model, inputs } });

const setRequest = (id: string, patch: Record<string, unknown>) =>
  fetch(`${replicateUrl}/__control/hf/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });

const poll = (session: Session, id: string) =>
  api(`/api/predictions/${encodeURIComponent(id)}`, { session });

async function startRun(inputs = VALID) {
  const { status, data } = await start(alice.session, inputs);
  expect(status).toBe(200);
  return (data.tracking as { predictionId: string }).predictionId;
}

describe("higgsfield", () => {
  it("reports whether it's set up, to signed-in users only", async () => {
    expect((await api("/api/higgsfield/generate", { session: alice.session })).data).toEqual({ enabled: true });
    expect((await api("/api/higgsfield/generate")).status).toBe(401);
    expect((await start(null)).status).toBe(401);
  });

  it("lists every model, and each one's form settings", async () => {
    const list = await api("/api/higgsfield/models", { session: alice.session });
    expect(list.data.enabled).toBe(true);
    expect(list.data.models).toEqual([
      expect.objectContaining({ id: SEEDANCE, output: "video", category: "text-to-video", task: "Text to video" }),
      expect.objectContaining({ id: SOUL, output: "image", category: "image-edit", task: "Image to image" }),
    ]);
    expect((await api("/api/higgsfield/models")).status).toBe(401);

    const soul = await api(`/api/higgsfield/models/schema?model=${encodeURIComponent(SOUL)}`, { session: alice.session });
    // Same shape as a Replicate model's settings; nested
    // settings left out; nullable types unwrapped
    const soulSchema = soul.data.inputSchema as Record<string, unknown>;
    expect(Object.keys(soulSchema)).toEqual(["prompt", "image_urls", "seed"]);
    expect(soulSchema.image_urls).toMatchObject({ type: "array", format: "uri" });
    expect(soulSchema.seed).toMatchObject({ type: "integer" });

    const seedance = await api(`/api/higgsfield/models/schema?model=${encodeURIComponent(SEEDANCE)}`, { session: alice.session });
    expect((seedance.data.inputSchema as Record<string, unknown>).resolution).toMatchObject({ enum: ["480p", "720p", "1080p"], default: "720p" });

    expect((await api("/api/higgsfield/models/schema?model=nope/nope", { session: alice.session })).status).toBe(404);
  });

  it("refuses bad input before calling Higgsfield", async () => {
    const before = (await replicateRequests()).filter((r) => r.path.startsWith("/hf/") && r.method === "POST").length;

    expect((await start(alice.session, { ...VALID, prompt: "  " })).status).toBe(400);
    expect((await start(alice.session, VALID, "No such project")).status).toBe(400);
    expect((await start(alice.session, VALID, project.name, "nope/nope")).status).toBe(400);
    // Soul needs an image
    const noImage = await start(alice.session, { prompt: "x", image_urls: [] }, project.name, SOUL);
    expect(noImage.status).toBe(400);
    expect(noImage.data.error).toMatch(/image urls/);

    const after = (await replicateRequests()).filter((r) => r.path.startsWith("/hf/") && r.method === "POST").length;
    expect(after).toBe(before);
  });

  it("runs to a saved, billed video", async () => {
    // Settings the model doesn't have are dropped
    const { data } = await start(alice.session, { ...VALID, sneaky: "x", multi_prompt: "[]" });
    const id = (data.tracking as { predictionId: string }).predictionId;
    expect(data.costUsd).toBeCloseTo(2.311);

    // Sent exactly the model's inputs, to the model's path
    const sent = (await replicateRequests()).filter((r) => r.path === "/hf/bytedance/seedance-2.5/text-to-video").at(-1);
    expect(sent?.body).toEqual(VALID);

    expect((await poll(alice.session, id)).data.status).toBe("starting");

    await setRequest(id, { status: "in_progress" });
    expect((await poll(alice.session, id)).data.status).toBe("processing");

    await setRequest(id, { status: "completed", video: { url: `${replicateUrl}/__control/output.mp4` } });
    const done = await poll(alice.session, id);
    expect(done.data.status).toBe("succeeded");
    expect(done.data.costUsd).toBeCloseTo(2.311);
    // Our saved copy, not Higgsfield's link
    expect(done.data.output).toBe(`/api/generations/${id}/output`);

    const saved = await fetch(new URL(done.data.output as string, baseUrl), {
      headers: { cookie: alice.session.cookie },
    });
    expect(saved.headers.get("content-type")).toContain("video/mp4");
    expect(await saved.text()).toBe("fake-mp4-bytes");

    const expense = await (await db()).collection("expenses").findOne({ _id: id as never });
    expect(expense).toMatchObject({ provider: "higgsfield", amountUsd: 2.311, model: "bytedance/seedance-2.5/text-to-video" });

    const history = await api("/api/generations?options=0", { session: alice.session });
    const row = (history.data.generations as { id: string; provider: string; status: string }[]).find((item) => item.id === id);
    expect(row).toMatchObject({ provider: "higgsfield", status: "succeeded" });

    // Someone else's run reads as not found
    expect((await poll(bob.session, id)).status).toBe(404);
  });

  it("runs image models, with their images in the model's types", async () => {
    const image = "https://example.com/cat.png";
    const { status, data } = await start(
      alice.session,
      { prompt: "a cat", image_urls: [image], seed: "42", multi_prompt: [{ prompt: "x" }] },
      project.name,
      SOUL
    );
    expect(status).toBe(200);
    // No published price: unpriced, not $0
    expect(data.costUsd).toBeNull();

    const sent = (await replicateRequests()).filter((r) => r.path === `/hf/${SOUL}`).at(-1);
    expect(sent?.body).toEqual({ prompt: "a cat", image_urls: [image], seed: 42 });

    const id = (data.tracking as { predictionId: string }).predictionId;
    await setRequest(id, {
      status: "completed",
      images: [{ url: `${replicateUrl}/__control/output.png` }, { url: `${replicateUrl}/__control/output.png?2` }],
    });

    const done = await poll(alice.session, id);
    expect(done.data.status).toBe("succeeded");
    expect(done.data.output).toBe(`/api/generations/${id}/output`);
    expect(done.data.costUsd).toBeNull();

    const expense = await (await db()).collection("expenses").findOne({ _id: id as never });
    expect(expense).toMatchObject({ provider: "higgsfield", amountUsd: null, model: SOUL });

    const generation = await (await db()).collection("generations").findOne({ _id: id as never });
    expect(generation).toMatchObject({ inputImage: image, outputContentType: "image/png" });
  });

  it("reports moderation, failures and cancels without billing them", async () => {
    const cases: [Record<string, unknown>, string, RegExp | null][] = [
      [{ status: "nsfw" }, "failed", /moderation/i],
      [{ status: "failed", error: "Your credit balance is too low to complete this request." }, "failed", /credit balance/],
      [{ status: "completed" }, "failed", /without a result/],
      [{ status: "canceled" }, "canceled", null],
    ];

    for (const [patch, status, message] of cases) {
      const id = await startRun();
      await setRequest(id, patch);

      const { data } = await poll(alice.session, id);
      expect(data.status, JSON.stringify(patch)).toBe(status);
      if (message) expect(data.error).toMatch(message);
      expect(data.costUsd).toBeNull();

      expect(await (await db()).collection("expenses").findOne({ _id: id as never })).toBeNull();
    }
  });

  it("explains rejected starts", async () => {
    const noCredits = await start(alice.session, { ...VALID, prompt: "nocredits please" });
    expect(noCredits.status).toBe(402);
    expect(noCredits.data.error).toMatch(/credits/);

    const rejected = await start(alice.session, { ...VALID, prompt: "reject this" });
    expect(rejected.status).toBe(422);
  });
});

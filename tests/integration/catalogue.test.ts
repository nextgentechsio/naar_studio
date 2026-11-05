import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN, FAKE_GOOGLE_USAGE, FAKE_OPENAI_USAGE } from "./fake-replicate";
import {
  api,
  closeDb,
  createProject,
  createUser,
  db,
  fakeOutputUrl,
  loginRoot,
  replicateRequests,
  replicateUrl,
  setPrediction,
  type Session,
} from "./helpers";

// --------------------------------------------------
// Catalogue: library, products and the shoot flow.
// Every image is a normal generation, so it's priced and
// counted in expenses; finished images are copied to
// catalogue/ so they outlive output retention.
// --------------------------------------------------

type Product = {
  id: string;
  status: string;
  owner: { id: string };
  inputs: Record<string, string>;
  shots: {
    shotId: string;
    selected: string | null;
    runs: { generationId: string; status: string; imageUrl: string | null; feedback: string; error?: string | null }[];
  }[];
  spendUsd: number;
};
type Template = { id: string; name: string; shots: { id: string; type: string }[] };

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

async function storeBlob(pathname: string, contentType = "image/png") {
  const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": contentType },
    body: new Uint8Array([1, 2, 3, 4]),
  });
  return ((await response.json()) as { url: string }).url;
}

const token = (session: Session, pathname: string) =>
  api("/api/catalogue/upload", {
    session,
    json: { type: "blob.generate-client-token", payload: { pathname, multipart: false, clientPayload: null } },
  });

async function library(session: Session) {
  const { status, data } = await api("/api/catalogue/library", { session });
  expect(status).toBe(200);
  return data as { assets: { id: string; kind: string; name: string }[]; templates: Template[]; canEdit: boolean };
}

async function newProduct(session: Session, name = "Linen shirt") {
  const { status, data } = await api("/api/catalogue/products", {
    session,
    json: { name, sku: "LS-01", category: "Shirts", gender: "male", project: project.name },
  });
  expect(status).toBe(200);
  return data.product as Product;
}

const product = async (session: Session, id: string) => {
  const { status, data } = await api(`/api/catalogue/products/${id}`, { session });
  expect(status).toBe(200);
  return data.product as Product;
};

const action = (session: Session, id: string, name: string, json: Record<string, unknown> = {}) =>
  api(`/api/catalogue/products/${id}/${name}`, { session, json });

// The last prediction the app started for a model
async function predictionsSince(count: number) {
  return (await replicateRequests()).filter((r) => r.method === "POST" && /\/predictions$/.test(r.path)).slice(count);
}
const predictionCount = async () => (await predictionsSince(0)).length;

async function succeed(ids: string[]) {
  for (const id of ids) await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
}

describe("catalogue library", () => {
  it("ships built-in presets that everyone can read but only admins can change", async () => {
    const lib = await library(alice.session);
    expect(lib.canEdit).toBe(false);
    for (const kind of ["model", "pose", "background"]) {
      expect(lib.assets.some((asset) => asset.kind === kind)).toBe(true);
    }
    expect(lib.templates.length).toBeGreaterThan(0);
    expect(lib.templates.every((template) => template.shots[0].type === "initial")).toBe(true);

    const denied = await api("/api/catalogue/library", {
      session: alice.session,
      json: { kind: "pose", name: "Lean", prompt: "POSE: leaning" },
    });
    expect(denied.status).toBe(403);

    expect((await library(admin.session)).canEdit).toBe(true);
    const created = await api("/api/catalogue/library", {
      session: admin.session,
      json: { kind: "pose", name: "Lean", prompt: "POSE: leaning on a wall" },
    });
    expect(created.status).toBe(200);
    const id = (created.data.asset as { id: string }).id;

    const archived = await api(`/api/catalogue/assets/${id}`, { session: admin.session, method: "PATCH", json: { status: "archived" } });
    expect(archived.status).toBe(200);
    expect((await library(alice.session)).assets.some((asset) => asset.id === id)).toBe(false);

    expect((await api(`/api/catalogue/assets/${id}`, { session: alice.session, method: "DELETE" })).status).toBe(403);
    expect((await api(`/api/catalogue/assets/${id}`, { session: admin.session, method: "DELETE" })).status).toBe(200);
    expect(await (await db()).collection("catalogueAssets").countDocuments({ name: "Lean" })).toBe(0);
  });

  it("remembers a deleted built-in so it isn't seeded again", async () => {
    const builtIn = (await library(admin.session)).assets.find((asset) => asset.kind === "accessory")!;
    expect((await api(`/api/catalogue/assets/${builtIn.id}`, { session: admin.session, method: "DELETE" })).status).toBe(200);
    expect((await library(admin.session)).assets.some((asset) => asset.id === builtIn.id)).toBe(false);
    const marker = await (await db()).collection("catalogueAssets").findOne({ name: builtIn.name });
    expect(marker).toMatchObject({ deleted: true, presetKey: expect.any(String) });
    expect((await api(`/api/catalogue/assets/${builtIn.id}`, { session: admin.session, method: "DELETE" })).status).toBe(404);
  });

  it("checks templates: the first shot must be the initial look", async () => {
    const bad = await api("/api/catalogue/templates", {
      session: admin.session,
      json: { name: "Bad", shots: [{ label: "Front", type: "front", prompt: "Front view" }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/initial look/);

    const good = await api("/api/catalogue/templates", {
      session: admin.session,
      json: {
        name: "Two shots",
        shots: [
          { label: "Initial", type: "initial", prompt: "Full length of {{product}}" },
          { label: "Back", type: "back", prompt: "Back view" },
        ],
      },
    });
    expect(good.status).toBe(200);
    expect((good.data.template as Template).shots.map((shot) => shot.id)).toEqual(["initial", "back"]);
  });

  it("gives upload tokens only for folders the user may write", async () => {
    const mine = await newProduct(alice.session);
    expect((await token(alice.session, `catalogue/${alice.id}/products/${mine.id}/inputs/front.png`)).status).toBe(200);
    expect((await token(bob.session, `catalogue/${alice.id}/products/${mine.id}/inputs/front.png`)).status).toBe(400);
    expect((await token(admin.session, `catalogue/${alice.id}/products/${mine.id}/inputs/front.png`)).status).toBe(200);
    expect((await token(alice.session, "catalogue/library/face.png")).status).toBe(400);
    expect((await token(admin.session, "catalogue/library/face.png")).status).toBe(200);
    expect((await token(alice.session, "inputs/front.png")).status).toBe(400);
  });
});

describe("catalogue shoot", () => {
  let template: Template;
  let item: Product;

  it("needs a real project and keeps products private", async () => {
    const noProject = await api("/api/catalogue/products", { session: alice.session, json: { name: "X", project: "Nope" } });
    expect(noProject.status).toBe(400);

    item = await newProduct(alice.session, "Linen shirt");
    expect(item.status).toBe("draft");
    expect((await api(`/api/catalogue/products/${item.id}`, { session: bob.session })).status).toBe(404);
    expect((await api(`/api/catalogue/products/${item.id}`, { session: admin.session })).status).toBe(200);

    const bobsList = await api("/api/catalogue/products", { session: bob.session });
    expect((bobsList.data.products as { id: string }[]).some((p) => p.id === item.id)).toBe(false);
  });

  it("accepts garment photos only from the product's own folder", async () => {
    const elsewhere = await storeBlob(`catalogue/${bob.id}/products/${item.id}/inputs/front.png`);
    const rejected = await api(`/api/catalogue/products/${item.id}`, {
      session: alice.session,
      method: "PATCH",
      json: { inputs: { front: elsewhere } },
    });
    expect(rejected.status).toBe(403);

    const front = await storeBlob(`catalogue/${alice.id}/products/${item.id}/inputs/front.png`);
    template = (await library(alice.session)).templates.find((t) => t.shots.length >= 3)!;
    const { status, data } = await api(`/api/catalogue/products/${item.id}`, {
      session: alice.session,
      method: "PATCH",
      // Replicate here; the direct engines are tested below
      json: { inputs: { front }, templateId: template.id, resolution: "2K", imageModel: "google/nano-banana-2" },
    });
    expect(status).toBe(200);
    item = data.product as Product;
    expect(item.inputs.front).toBe(front);
    expect(item.shots.map((shot) => shot.shotId)).toEqual(template.shots.map((shot) => shot.id));
  });

  it("generates the initial look as a billed generation and keeps a copy", async () => {
    const before = await predictionCount();
    const { status, data } = await action(alice.session, item.id, "generate");
    expect(status).toBe(200);
    item = data.product as Product;
    expect(item.status).toBe("initial");

    const [request] = await predictionsSince(before);
    expect(request.path).toContain("google/nano-banana-2");
    const input = (request.body as { input: Record<string, unknown> }).input;
    expect(input.image_input).toEqual([item.inputs.front]);
    expect(input.aspect_ratio).toBe("3:4");
    expect(input.resolution).toBe("2K");
    expect(String(input.prompt)).toContain("Linen shirt");

    const run = item.shots[0].runs[0];
    expect(run.status).toBe("pending");
    const generation = await (await db()).collection("generations").findOne({ _id: run.generationId as never });
    expect(generation).toMatchObject({ userId: alice.id, projectId: project.id, model: "google/nano-banana-2" });

    await succeed([run.generationId]);
    item = await product(alice.session, item.id);
    const done = item.shots[0].runs[0];
    expect(done.status).toBe("succeeded");
    expect(done.imageUrl).toContain(`catalogue/${alice.id}/products/${item.id}/shots/`);
    expect(item.shots[0].selected).toBe(run.generationId);

    const expenses = await (await db()).collection("expenses").find({ _id: run.generationId as never }).toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountUsd).toBeCloseTo(0.101);
    expect(item.spendUsd).toBeCloseTo(0.101);
  });

  it("retries with feedback without approving", async () => {
    const before = await predictionCount();
    const { status, data } = await action(alice.session, item.id, "generate", { feedback: "Make the sleeves rolled up" });
    expect(status).toBe(200);
    const [request] = await predictionsSince(before);
    expect(String((request.body as { input: { prompt: string } }).input.prompt)).toContain("Make the sleeves rolled up");

    const retry = (data.product as Product).shots[0].runs[0];
    await setPrediction(retry.generationId, { status: "failed", error: "NSFW filter" });
    item = await product(alice.session, item.id);
    expect(item.shots[0].runs[0]).toMatchObject({ status: "failed" });
    // The earlier version stays in use
    expect(item.shots[0].selected).toBe(item.shots[0].runs[1].generationId);
  });

  it("approves: shoots every other shot with the initial look as reference", async () => {
    const initialUrl = item.shots[0].runs.find((run) => run.status === "succeeded")!.imageUrl;
    const before = await predictionCount();
    const { status, data } = await action(alice.session, item.id, "approve");
    expect(status).toBe(200);
    item = data.product as Product;
    expect(item.status).toBe("shooting");

    const started = await predictionsSince(before);
    expect(started).toHaveLength(template.shots.length - 1);
    for (const request of started) {
      expect((request.body as { input: { image_input: string[] } }).input.image_input).toContain(initialUrl);
    }

    // Can't approve twice, or generate a new initial look
    expect((await action(alice.session, item.id, "approve")).status).toBe(409);
    expect((await action(alice.session, item.id, "generate")).status).toBe(409);

    const pending = item.shots.slice(1).map((shot) => shot.runs[0].generationId);
    await succeed(pending);
    item = await product(alice.session, item.id);
    expect(item.status).toBe("done");
    expect(item.shots.every((shot) => shot.selected)).toBe(true);
  });

  it("regenerates one shot with feedback, and can switch back", async () => {
    const shot = item.shots[1];
    const first = shot.selected!;
    const { status, data } = await action(alice.session, item.id, "regenerate", { shotId: shot.shotId, feedback: "Lower the camera" });
    expect(status).toBe(200);
    // One at a time per shot
    expect((await action(alice.session, item.id, "regenerate", { shotId: shot.shotId })).status).toBe(409);

    const latest = (data.product as Product).shots[1].runs[0];
    expect(latest.feedback).toBe("Lower the camera");
    await succeed([latest.generationId]);
    item = await product(alice.session, item.id);
    // The new version doesn't replace the chosen one by itself
    expect(item.shots[1].selected).toBe(first);

    const picked = await action(alice.session, item.id, "select", { shotId: shot.shotId, generationId: latest.generationId });
    expect(picked.status).toBe(200);
    expect((picked.data.product as Product).shots[1].selected).toBe(latest.generationId);
  });

  it("totals each product's spend from expenses and locks its project once billed", async () => {
    const runIds = item.shots.flatMap((shot) => shot.runs.map((run) => run.generationId));
    const expenses = await (await db()).collection("expenses").find({ _id: { $in: runIds as never[] } }).toArray();
    const billed = expenses.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0);
    expect(expenses.every((row) => row.projectId === project.id)).toBe(true);

    const { data } = await api("/api/catalogue/products", { session: alice.session });
    const summary = (data.products as { id: string; spendUsd: number; images: number }[]).find((p) => p.id === item.id)!;
    expect(summary.spendUsd).toBeCloseTo(billed);
    expect(summary.images).toBe(item.shots.flatMap((shot) => shot.runs).filter((run) => run.status === "succeeded").length);

    const other = await createProject(root);
    const moved = await api(`/api/catalogue/products/${item.id}`, { session: alice.session, method: "PATCH", json: { project: other.name } });
    expect(moved.status).toBe(409);
    expect((await product(alice.session, item.id)) as Product & { projectLocked: boolean }).toMatchObject({ projectLocked: true });

    // A product with nothing run yet can still move
    const fresh = await newProduct(alice.session, "Draft tee");
    const ok = await api(`/api/catalogue/products/${fresh.id}`, { session: alice.session, method: "PATCH", json: { project: other.name } });
    expect(ok.status).toBe(200);
    expect((ok.data.product as { project: { id: string } }).project.id).toBe(other.id);
  });

  it("can't be worked on by someone else, and deleting removes its files", async () => {
    expect((await action(bob.session, item.id, "generate")).status).toBe(404);

    const folder = `catalogue/${alice.id}/products/${item.id}/`;
    const blobsIn = async () =>
      ((await (await fetch(`${replicateUrl}/__control/blobs`)).json()) as { blobs: { pathname: string }[] }).blobs.filter(
        (blob) => blob.pathname.startsWith(folder),
      );
    expect((await blobsIn()).length).toBeGreaterThan(0);

    expect((await api(`/api/catalogue/products/${item.id}`, { session: alice.session, method: "DELETE" })).status).toBe(200);
    expect(await blobsIn()).toHaveLength(0);
    expect((await api(`/api/catalogue/products/${item.id}`, { session: alice.session })).status).toBe(404);
    // Its generations (and expenses) stay
    const runIds = item.shots.flatMap((shot) => shot.runs.map((run) => run.generationId));
    expect(await (await db()).collection("expenses").countDocuments({ _id: { $in: runIds as never[] } })).toBeGreaterThan(0);
  });
});

describe("catalogue direct engines (Google, OpenAI)", () => {
  let item: Product;

  // A direct run finishes on the server after the response
  async function settle(id: string) {
    for (let i = 0; i < 50; i++) {
      const current = await product(alice.session, id);
      if (!current.shots.some((shot) => shot.runs.some((run) => run.status === "pending"))) return current;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("run never finished");
  }

  const requestsTo = async (prefix: string, since: number) =>
    (await replicateRequests()).slice(since).filter((r) => r.path.startsWith(prefix));

  it("makes images with Google Nano Banana 2.1, billed from the tokens it used", async () => {
    item = await newProduct(alice.session, "Cotton kurta");
    const front = await storeBlob(`catalogue/${alice.id}/products/${item.id}/inputs/front.png`);
    const quick = (await library(alice.session)).templates.find((t) => t.shots.length === 3) ?? (await library(alice.session)).templates[0];
    await api(`/api/catalogue/products/${item.id}`, { session: alice.session, method: "PATCH", json: { inputs: { front }, templateId: quick.id, resolution: "1K", imageModel: "google:gemini-nano-banana-2.1" } });

    const since = (await replicateRequests()).length;
    expect((await action(alice.session, item.id, "generate")).status).toBe(200);
    item = await settle(item.id);
    const run = item.shots[0].runs[0];
    expect(run.status).toBe("succeeded");
    expect(run.imageUrl).toContain(`catalogue/${alice.id}/products/${item.id}/shots/`);

    const [call] = await requestsTo("/google/", since);
    expect(call.path).toBe("/google/v1beta/models/gemini-nano-banana-2.1:generateContent");
    const body = call.body as { contents: { parts: { inlineData?: unknown; text?: string }[] }[]; generationConfig: { imageConfig: unknown } };
    expect(body.contents[0].parts.filter((part) => part.inlineData)).toHaveLength(1);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "3:4", imageSize: "1K" });
    // Nothing went to Replicate
    expect((await replicateRequests()).slice(since).some((r) => r.path.startsWith("/v1/"))).toBe(false);

    const generation = await (await db()).collection("generations").findOne({ _id: run.generationId as never });
    expect(generation).toMatchObject({ provider: "catalogue", model: "google-api/gemini-nano-banana-2.1", projectId: project.id, status: "succeeded" });
    const expected = (FAKE_GOOGLE_USAGE.promptTokenCount * 1.5 + 1680 * 30 + (100 + FAKE_GOOGLE_USAGE.thoughtsTokenCount) * 7.5) / 1e6;
    const [expense] = await (await db()).collection("expenses").find({ _id: run.generationId as never }).toArray();
    expect(expense).toMatchObject({ provider: "catalogue", projectId: project.id, userId: alice.id });
    expect(expense.amountUsd).toBeCloseTo(expected, 6);
    expect(item.spendUsd).toBeCloseTo(expected, 3);
  });

  it("fails a blocked image cleanly, with nothing billed", async () => {
    const { status, data } = await action(alice.session, item.id, "generate", { feedback: "blockme please" });
    expect(status).toBe(200);
    const id = (data.product as Product).shots[0].runs[0].generationId;
    item = await settle(item.id);
    const failed = item.shots[0].runs.find((run) => run.generationId === id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error ?? "").toMatch(/didn't make an image/);
    expect(await (await db()).collection("expenses").countDocuments({ _id: id as never })).toBe(0);
  });

  it("uses OpenAI GPT Image with the reference photos, billed from its usage", async () => {
    await api(`/api/catalogue/products/${item.id}`, { session: alice.session, method: "PATCH", json: { imageModel: "openai:gpt-image-2.5-sunburst" } });
    const since = (await replicateRequests()).length;
    const { data } = await action(alice.session, item.id, "approve");
    expect((data.product as Product).status).toBe("shooting");
    item = await settle(item.id);
    expect(item.status).toBe("done");

    const calls = await requestsTo("/openai/", since);
    expect(calls.length).toBe(item.shots.length - 1);
    // Garment front + the initial look
    for (const call of calls) {
      expect(call.path).toBe("/openai/images/edits");
      expect((call.body as { imageParts: number }).imageParts).toBe(2);
    }
    const expected = (1500 * 5 + 1500 * 8 + FAKE_OPENAI_USAGE.output_tokens * 30) / 1e6;
    const ids = item.shots.slice(1).map((shot) => shot.runs[0].generationId);
    const expenses = await (await db()).collection("expenses").find({ _id: { $in: ids as never[] } }).toArray();
    expect(expenses).toHaveLength(ids.length);
    for (const row of expenses) {
      expect(row.provider).toBe("catalogue");
      expect(row.amountUsd).toBeCloseTo(expected, 6);
    }
  });

  it("shows up as one Catalogue platform in Expenses, whichever engine made it", async () => {
    const catalogue = await api("/api/expenses/entries?provider=catalogue", { session: alice.session });
    const replicate = await api("/api/expenses/entries?provider=replicate", { session: alice.session });
    expect(catalogue.status).toBe(200);
    const ids = (res: typeof catalogue) => JSON.stringify(res.data);
    const kurta = item.shots.flatMap((shot) => shot.runs).filter((run) => run.status === "succeeded");
    expect(kurta.some((run) => run.generationId.startsWith("google-"))).toBe(true);
    expect(kurta.some((run) => run.generationId.startsWith("openai-"))).toBe(true);
    for (const run of kurta) {
      expect(ids(catalogue)).toContain(run.generationId);
      expect(ids(replicate)).not.toContain(run.generationId);
    }
  });
});

describe("catalogue blob folder", () => {
  const stored = async () =>
    ((await (await fetch(`${replicateUrl}/__control/blobs`)).json()) as { blobs: { url: string }[] }).blobs.map(
      (blob) => blob.url,
    );

  it("removes a library photo once it's replaced or its item is deleted", async () => {
    const first = await storeBlob(`catalogue/library/face-${Date.now()}-a.png`);
    const second = await storeBlob(`catalogue/library/face-${Date.now()}-b.png`);
    // Someone's upload whose dialog is still open
    const pending = await storeBlob(`catalogue/library/face-${Date.now()}-c.png`);

    const created = await api("/api/catalogue/library", {
      session: admin.session,
      json: { kind: "model", name: "Tidy", prompt: "A model", imageUrl: first },
    });
    expect(created.status).toBe(200);
    const id = (created.data.asset as { id: string }).id;

    const patched = await api(`/api/catalogue/assets/${id}`, {
      session: admin.session,
      method: "PATCH",
      json: { imageUrl: second },
    });
    expect(patched.status).toBe(200);
    let files = await stored();
    expect(files).not.toContain(first);
    expect(files).toContain(second);

    expect((await api(`/api/catalogue/assets/${id}`, { session: admin.session, method: "DELETE" })).status).toBe(200);
    files = await stored();
    expect(files).not.toContain(second);
    expect(files).toContain(pending);
  });

  it("removes replaced and removed garment photos, and nothing else", async () => {
    const mine = await newProduct(alice.session, "Tidy shirt");
    const other = await newProduct(alice.session, "Other shirt");
    const folder = (id: string) => `catalogue/${alice.id}/products/${id}/inputs/`;
    const front = await storeBlob(`${folder(mine.id)}front-1.png`);
    const back = await storeBlob(`${folder(mine.id)}back-1.png`);
    const otherFront = await storeBlob(`${folder(other.id)}front-1.png`);
    const patch = (id: string, inputs: Record<string, string | null>) =>
      api(`/api/catalogue/products/${id}`, { session: alice.session, method: "PATCH", json: { inputs } });

    expect((await patch(mine.id, { front, back })).status).toBe(200);
    expect((await patch(other.id, { front: otherFront })).status).toBe(200);

    const newFront = await storeBlob(`${folder(mine.id)}front-2.png`);
    // Uploaded a moment ago, not saved yet
    const pending = await storeBlob(`${folder(mine.id)}detail-1.png`);
    const { status, data } = await patch(mine.id, { front: newFront, back: null });
    expect(status).toBe(200);
    expect((data.product as Product).inputs).toEqual({ front: newFront });

    const files = await stored();
    expect(files).not.toContain(front);
    expect(files).not.toContain(back);
    expect(files).toEqual(expect.arrayContaining([newFront, pending, otherFront]));
  });
});

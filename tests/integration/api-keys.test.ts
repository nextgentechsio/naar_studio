import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, baseUrl, closeDb, createProject, createUser, db, fakeOutputUrl, loginRoot, replicateUrl, setPrediction, type Session } from "./helpers";

// --------------------------------------------------
// Naar Studio API keys: an admin makes a key for an
// account; a script uses it on /api/v1 to generate as
// that account; every run and its cost is tracked to the
// key, with a monthly cap.
// --------------------------------------------------

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };
let other: { id: string; name: string };

type Key = { id: string; name: string; prefix: string; userId: string; projects: { id: string }[]; spend: { amountUsd: number; count: number; inFlight: number }; monthlyCapUsd: number | null; revokedAt: string | null };

async function makeKey(session: Session, fields: Record<string, unknown>) {
  const response = await api("/api/admin/api-keys", {
    session,
    json: { name: "Test key", userId: alice.id, projectIds: [project.id], platforms: ["replicate"], ...fields },
  });
  return { status: response.status, key: response.data.key as Key, secret: response.data.secret as string, error: response.data.error };
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

const v1 = (secret: string, path: string, options: { method?: string; json?: unknown } = {}) =>
  api(`/api/v1${path}`, { headers: bearer(secret), ...options });

// Starts a run with a key and finishes it on the fake
// provider, polling as a script would, until it's settled
async function runToEnd(secret: string, status = "succeeded") {
  const started = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "a red bicycle" } } });
  expect(started.status).toBe(202);
  const id = started.data.id as string;
  await setPrediction(id, { status, output: status === "succeeded" ? [fakeOutputUrl()] : null });
  for (let i = 0; i < 100; i++) {
    const current = await v1(secret, `/generations/${id}`);
    const done = ["succeeded", "failed", "canceled"].includes(current.data.status as string) && (status !== "succeeded" || current.data.output);
    if (done) return current.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${id} never settled`);
}

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
  other = await createProject(root);
});

afterAll(closeDb);

describe("managing keys", () => {
  it("an admin creates a key for an account and sees the secret once", async () => {
    const created = await makeKey(admin.session, { name: "Acme website", monthlyCapUsd: 25 });
    expect(created.status).toBe(201);
    expect(created.secret).toMatch(/^naar_live_[A-Za-z0-9]{43}$/);
    expect(created.key).toMatchObject({ name: "Acme website", prefix: created.secret.slice(0, 14), userId: alice.id, monthlyCapUsd: 25 });
    expect(created.key.spend).toMatchObject({ amountUsd: 0, count: 0, inFlight: 0 });

    // Listed without the secret; only its hash is stored
    const list = await api("/api/admin/api-keys", { session: admin.session });
    expect(list.status).toBe(200);
    const row = (list.data.keys as Key[]).find((key) => key.id === created.key.id)!;
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(created.secret.slice(14));
    const doc = await (await db()).collection("apiKeys").findOne({ prefix: created.key.prefix, name: "Acme website" });
    expect(doc?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(doc)).not.toContain(created.secret.slice(14));
  });

  it("checks the fields", async () => {
    expect((await makeKey(admin.session, { name: "" })).status).toBe(400);
    expect((await makeKey(admin.session, { projectIds: [] })).status).toBe(400);
    expect((await makeKey(admin.session, { projectIds: ["nope"] })).status).toBe(400);
    expect((await makeKey(admin.session, { platforms: ["catalogue"] })).status).toBe(400);
    expect((await makeKey(admin.session, { monthlyCapUsd: -1 })).status).toBe(400);
    expect((await makeKey(admin.session, { concurrency: 0 })).status).toBe(400);
    expect((await makeKey(admin.session, { expiresAt: "2001-01-01" })).status).toBe(400);
    expect((await makeKey(admin.session, { userId: "nobody" })).status).toBe(400);
  });

  it("a user can't manage keys; an admin can't make one for another admin", async () => {
    expect((await api("/api/admin/api-keys", { session: alice.session })).status).toBe(403);
    expect((await makeKey(alice.session, {})).status).toBe(403);
    const forAdmin = await makeKey(admin.session, { userId: (await createUser(root, "admin")).id });
    expect(forAdmin.status).toBe(400);
    // The super admin can; an admin can make one for themselves
    expect((await makeKey(root, { userId: admin.id })).status).toBe(201);
    expect((await makeKey(admin.session, { userId: admin.id })).status).toBe(201);
  });

  it("a key only gets platforms its account has", async () => {
    const limited = await createUser(root, "user");
    await api(`/api/users/${limited.id}`, { session: root, method: "PATCH", json: { platforms: ["higgsfield"] } });
    expect((await makeKey(root, { userId: limited.id, platforms: ["replicate"] })).status).toBe(400);
    expect((await makeKey(root, { userId: limited.id, platforms: ["higgsfield"] })).status).toBe(201);
  });
});

describe("using a key", () => {
  let secret: string;
  let key: Key;

  beforeAll(async () => {
    const created = await makeKey(admin.session, { name: "Script", projectIds: [project.id, other.id] });
    secret = created.secret;
    key = created.key;
  });

  it("refuses missing, wrong and cookie auth with one error shape", async () => {
    const none = await api("/api/v1/generations");
    expect(none.status).toBe(401);
    expect(none.data).toEqual({ error: { code: "missing_api_key", message: expect.any(String) } });
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    const wrong = await v1(`naar_live_${"x".repeat(43)}`, "/generations");
    expect(wrong.status).toBe(401);
    expect((wrong.data.error as { code: string }).code).toBe("invalid_api_key");
    // A signed-in browser session is not an API key
    expect((await api("/api/v1/generations", { session: alice.session })).status).toBe(401);
  });

  it("runs a generation as the key's account, tracked to the key, and serves the output", async () => {
    const finished = await runToEnd(secret);
    expect(finished).toMatchObject({
      object: "generation",
      platform: "replicate",
      model: "google/nano-banana",
      project: { id: project.id, name: project.name },
      status: "succeeded",
      input: { prompt: "a red bicycle" },
      output: { url: expect.stringContaining(`/api/v1/generations/${finished.id}/output`), contentType: "image/png" },
    });
    expect(finished.costUsd).toBeGreaterThan(0);

    // Stored as Alice's run, started by this key, and billed to it
    const doc = await (await db()).collection("generations").findOne({ _id: finished.id as never });
    expect(doc).toMatchObject({ userId: alice.id, apiKeyId: key.id, apiKeyName: "Script", status: "succeeded" });
    const expense = await (await db()).collection("expenses").findOne({ _id: finished.id as never });
    expect(expense).toMatchObject({ userId: alice.id, apiKeyId: key.id, apiKeyName: "Script", amountUsd: finished.costUsd });

    // The output streams from our copy, with Range support
    const output = await fetch(`${(finished.output as { url: string }).url}`, { headers: bearer(secret) });
    expect(output.status).toBe(200);
    expect(output.headers.get("content-type")).toBe("image/png");
    expect(output.headers.get("accept-ranges")).toBe("bytes");
    const part = await fetch(`${(finished.output as { url: string }).url}`, { headers: { ...bearer(secret), range: "bytes=0-3" } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(4);

    // It shows in Alice's own History, marked as the key's
    const history = await api("/api/generations", { session: alice.session });
    const row = (history.data.generations as { id: string; apiKeyName: string | null }[]).find((item) => item.id === finished.id);
    expect(row?.apiKeyName).toBe("Script");
  });

  it("bills a named project the key may use, and refuses others", async () => {
    const named = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "x" }, project: other.name } });
    expect(named.status).toBe(202);
    expect(named.data.project).toEqual({ id: other.id, name: other.name });
    await setPrediction(named.data.id as string, { status: "canceled" });

    const outside = await createProject(root);
    const refused = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "x" }, project: outside.id } });
    expect(refused.status).toBe(403);
    expect((refused.data.error as { code: string }).code).toBe("project_not_allowed");
  });

  it("validates a start like the website does", async () => {
    const noModel = await v1(secret, "/generations", { json: { input: { prompt: "x" } } });
    expect(noModel.status).toBe(400);
    expect((noModel.data.error as { code: string }).code).toBe("invalid_request");
    const badInput = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: "no" } });
    expect(badInput.status).toBe(400);
    const notJson = await api("/api/v1/generations", { headers: { ...bearer(secret), "content-type": "application/json" }, body: "{oops", method: "POST" });
    expect((notJson.data.error as { code: string }).code).toBe("invalid_json");
    const notOnKey = await v1(secret, "/generations", { json: { platform: "higgsfield", model: "x", input: {} } });
    expect(notOnKey.status).toBe(403);
    expect((notOnKey.data.error as { code: string }).code).toBe("platform_not_allowed");
    const unknown = await v1(secret, "/generations", { json: { platform: "catalogue", model: "x", input: {} } });
    expect(unknown.status).toBe(400);
  });

  it("lists the key's runs with a cursor, and only its own", async () => {
    const otherKey = await makeKey(admin.session, { name: "Other", userId: bob.id });
    const bobsRun = await runToEnd(otherKey.secret);

    const page = await v1(secret, "/generations?limit=1");
    expect(page.status).toBe(200);
    expect(page.data.object).toBe("list");
    expect(page.data.data).toHaveLength(1);
    expect(page.data.nextCursor).toBeTruthy();
    const next = await v1(secret, `/generations?limit=1&cursor=${page.data.nextCursor}`);
    expect((next.data.data as { id: string }[])[0].id).not.toBe((page.data.data as { id: string }[])[0].id);

    const all = await v1(secret, "/generations?limit=50");
    expect((all.data.data as { id: string }[]).map((item) => item.id)).not.toContain(bobsRun.id);
    // Another key's run reads as not found, so can't be probed
    expect((await v1(secret, `/generations/${bobsRun.id}`)).status).toBe(404);
    expect((await v1(secret, `/generations/${bobsRun.id}/output`)).status).toBe(404);
    expect((await v1(secret, `/generations/${bobsRun.id}/cancel`, { method: "POST" })).status).toBe(404);
  });

  it("cancels a running generation", async () => {
    const started = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "slow" } } });
    expect(started.status).toBe(202);
    const canceled = await v1(secret, `/generations/${started.data.id}/cancel`, { method: "POST" });
    expect(canceled.status).toBe(200);
    expect(canceled.data.status).toBe("canceled");
    const again = await v1(secret, `/generations/${started.data.id}/cancel`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  it("reports usage for the month", async () => {
    const usage = await v1(secret, "/usage");
    expect(usage.status).toBe(200);
    expect(usage.data).toMatchObject({ object: "usage", key: { id: key.id, name: "Script" }, cap: null });
    expect(usage.data.spentUsd).toBeGreaterThan(0);
    expect(usage.data.runs).toBeGreaterThanOrEqual(1);
    expect((usage.data.byModel as { id: string }[])[0].id).toBe("google/nano-banana");
    expect((await v1(secret, "/usage?month=2026-1")).status).toBe(400);
    const empty = await v1(secret, "/usage?month=2001-01");
    expect(empty.data).toMatchObject({ month: "2001-01", spentUsd: 0, runs: 0 });
  });

  it("lists models and a model's input schema", async () => {
    const models = await v1(secret, "/models");
    expect(models.status).toBe(200);
    expect((models.data.data as { id: string }[]).some((model) => model.id === "google/nano-banana")).toBe(true);
    const one = await v1(secret, "/models?model=google/nano-banana");
    expect(one.status).toBe(200);
    expect(one.data.inputSchema).toBeTruthy();
  });

  it("rotating gives a new secret and ends the old one; revoking ends the key", async () => {
    const rotated = await api(`/api/admin/api-keys/${key.id}/rotate`, { session: admin.session, method: "POST" });
    expect(rotated.status).toBe(200);
    const fresh = rotated.data.secret as string;
    expect(fresh).not.toBe(secret);
    expect((await v1(secret, "/usage")).status).toBe(401);
    expect((await v1(fresh, "/usage")).status).toBe(200);
    // Its runs stay with it
    expect((await v1(fresh, "/usage")).data.runs).toBeGreaterThanOrEqual(1);

    const revoked = await api(`/api/admin/api-keys/${key.id}`, { session: admin.session, method: "DELETE" });
    expect(revoked.status).toBe(200);
    expect((revoked.data.key as Key).revokedAt).toBeTruthy();
    const refused = await v1(fresh, "/usage");
    expect(refused.status).toBe(401);
    expect((refused.data.error as { code: string }).code).toBe("revoked_api_key");
    expect((await api(`/api/admin/api-keys/${key.id}`, { session: admin.session, method: "PATCH", json: { name: "x" } })).status).toBe(409);
  });

  it("an expired key and a disabled account are refused", async () => {
    const soon = await makeKey(root, { name: "Short", expiresAt: new Date(Date.now() + 1500).toISOString() });
    expect(soon.status).toBe(201);
    expect((await v1(soon.secret, "/usage")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const expired = await v1(soon.secret, "/usage");
    expect(expired.status).toBe(401);
    expect((expired.data.error as { code: string }).code).toBe("expired_api_key");

    const carol = await createUser(root, "user");
    const carols = await makeKey(root, { name: "Carol", userId: carol.id });
    await api(`/api/users/${carol.id}`, { session: root, method: "PATCH", json: { disabled: true } });
    const off = await v1(carols.secret, "/usage");
    expect(off.status).toBe(403);
    expect((off.data.error as { code: string }).code).toBe("account_disabled");
  });
});

describe("the monthly cap", () => {
  it("refuses a run at the cap, and alerts the owner and admins once", async () => {
    const created = await makeKey(admin.session, { name: "Capped", monthlyCapUsd: 1 });
    const { secret } = created;
    const finished = await runToEnd(secret);

    // Make that run cost the whole cap
    await (await db()).collection("expenses").updateOne({ _id: finished.id as never }, { $set: { amountUsd: 1 } });

    const refused = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "x" } } });
    expect(refused.status).toBe(402);
    expect((refused.data.error as { code: string }).code).toBe("spend_cap_reached");

    const usage = await v1(secret, "/usage");
    expect(usage.data.cap).toMatchObject({ monthlyUsd: 1, remainingUsd: 0, state: "reached" });

    // The admin's list shows it at the cap
    const list = await api("/api/admin/api-keys", { session: admin.session });
    const row = (list.data.keys as Key[]).find((item) => item.id === created.key.id)!;
    expect(row.spend.amountUsd).toBe(1);

    // One alert, to the owner and the admins
    let titles: string[] = [];
    for (let i = 0; i < 30 && !titles.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const mine = await api("/api/notifications", { session: alice.session });
      titles = (mine.data.notifications as { title: string }[]).map((item) => item.title).filter((title) => title.includes("Capped"));
    }
    expect(titles).toEqual(['API key "Capped" reached its monthly cap']);
    const admins = await api("/api/notifications", { session: admin.session });
    expect((admins.data.notifications as { title: string }[]).some((item) => item.title.includes("Capped"))).toBe(true);
    // Not Bob
    const bobs = await api("/api/notifications", { session: bob.session });
    expect((bobs.data.notifications as { title: string }[]).some((item) => item.title.includes("Capped"))).toBe(false);

    // Raising the cap lets runs through again
    await api(`/api/admin/api-keys/${created.key.id}`, { session: admin.session, method: "PATCH", json: { monthlyCapUsd: 100 } });
    const ok = await v1(secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "x" } } });
    expect(ok.status).toBe(202);
    await setPrediction(ok.data.id as string, { status: "canceled" });
  });

  it("limits runs in flight", async () => {
    const created = await makeKey(admin.session, { name: "One at a time", concurrency: 1 });
    const first = await v1(created.secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "x" } } });
    expect(first.status).toBe(202);
    const second = await v1(created.secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "y" } } });
    expect(second.status).toBe(429);
    expect((second.data.error as { code: string }).code).toBe("too_many_runs");
    await v1(created.secret, `/generations/${first.data.id}/cancel`, { method: "POST" });
    const third = await v1(created.secret, "/generations", { json: { model: "google/nano-banana", input: { prompt: "z" } } });
    expect(third.status).toBe(202);
    await setPrediction(third.data.id as string, { status: "canceled" });
  });
});

describe("the other platforms and uploads", () => {
  let secret: string;
  const SEEDANCE = "bytedance/seedance-2.5/text-to-video";

  beforeAll(async () => {
    secret = (await makeKey(admin.session, { name: "All platforms", platforms: ["replicate", "higgsfield", "elevenlabs"] })).secret;
  });

  it("runs a Higgsfield model, with its quote in flight and its billed cost at the end", async () => {
    const started = await v1(secret, "/generations", {
      json: { platform: "higgsfield", model: SEEDANCE, input: { prompt: "A cinematic scene at sunset", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true } },
    });
    expect(started.status, JSON.stringify(started.data)).toBe(202);
    expect(started.data).toMatchObject({ platform: "higgsfield", model: SEEDANCE, status: "starting" });
    const id = started.data.id as string;

    const usage = await v1(secret, "/usage");
    expect((usage.data.inFlight as { runs: number }).runs).toBe(1);

    await fetch(`${replicateUrl}/__control/hf/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed", video: { url: `${replicateUrl}/__control/output.mp4` } }),
    });
    let current;
    for (let i = 0; i < 100; i++) {
      current = (await v1(secret, `/generations/${id}`)).data;
      if (current.status === "succeeded" && current.output) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(current).toMatchObject({ status: "succeeded", costUsd: 1.7334, output: { contentType: "video/mp4" } });
    const expense = await (await db()).collection("expenses").findOne({ _id: id as never });
    expect(expense).toMatchObject({ provider: "higgsfield", amountUsd: 1.7334, apiKeyName: "All platforms", userId: alice.id });
  });

  it("runs an ElevenLabs model, billed by the text", async () => {
    const started = await v1(secret, "/generations", {
      json: { platform: "elevenlabs", model: "tts/eleven_multilingual_v2", input: { prompt: "Hello from the API.", voice_id: "voice-rachel" } },
    });
    expect(started.status, JSON.stringify(started.data)).toBe(202);
    expect(started.data).toMatchObject({ platform: "elevenlabs", status: "processing" });
    const id = started.data.id as string;
    let current;
    for (let i = 0; i < 100; i++) {
      current = (await v1(secret, `/generations/${id}`)).data;
      if (["succeeded", "failed"].includes(current.status as string) && current.output) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(current).toMatchObject({ status: "succeeded", output: { contentType: "audio/mpeg" } });
    expect(current!.costUsd).toBeGreaterThan(0);
    const served = await fetch((current!.output as { url: string }).url, { headers: bearer(secret) });
    expect(served.headers.get("content-type")).toContain("audio/mpeg");

    const bad = await v1(secret, "/generations", { json: { platform: "elevenlabs", model: "tts/eleven_multilingual_v2", input: { prompt: "" } } });
    expect(bad.status).toBe(400);
  });

  it("lists each platform's models and schemas", async () => {
    const all = await v1(secret, "/models");
    expect(all.data.platforms).toEqual(["replicate", "higgsfield", "elevenlabs"]);
    const ids = (all.data.data as { id: string; platform: string }[]);
    expect(ids.some((item) => item.platform === "higgsfield" && item.id === SEEDANCE)).toBe(true);
    expect(ids.some((item) => item.platform === "elevenlabs" && item.id === "tts/eleven_multilingual_v2")).toBe(true);

    const hf = await v1(secret, `/models?platform=higgsfield&model=${encodeURIComponent(SEEDANCE)}`);
    expect(hf.status).toBe(200);
    expect(hf.data.inputSchema).toHaveProperty("prompt");
    const el = await v1(secret, "/models?platform=elevenlabs&model=tts/eleven_multilingual_v2");
    expect((el.data.inputSchema as Record<string, { enum?: string[] }>).voice_id.enum).toContain("voice-rachel");
    expect((await v1(secret, "/models?platform=elevenlabs&model=nope")).status).toBe(404);
    expect((await v1(secret, "/models?platform=catalogue")).status).toBe(400);
  });

  it("uploads an input file and gives back a URL", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" }), "ref.png");
    const response = await fetch(`${baseUrl}/api/v1/files`, { method: "POST", headers: bearer(secret), body: form });
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(201);
    expect(data).toMatchObject({ object: "file", contentType: "image/png", size: 7 });
    expect(data.url).toContain("/blobfiles/inputs/api/");

    const text = new FormData();
    text.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    const refused = await fetch(`${baseUrl}/api/v1/files`, { method: "POST", headers: bearer(secret), body: text });
    expect(refused.status).toBe(415);
    const empty = await fetch(`${baseUrl}/api/v1/files`, { method: "POST", headers: { ...bearer(secret), "content-type": "application/json" }, body: "{}" });
    expect(empty.status).toBe(400);
  });
});

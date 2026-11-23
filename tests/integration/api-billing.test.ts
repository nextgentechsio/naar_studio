import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, baseUrl, closeDb, createProject, createUser, db, fakeOutputUrl, loginRoot, setPrediction } from "./helpers";

// --------------------------------------------------
// Naar Studio API: billing for a key (/api/v1/billing/*).
// A key sees only its own charges: summary, itemized
// charges, month by month, and a CSV/JSON statement.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };
let secret: string;
let keyId: string;
let bobsSecret: string;

const v1 = (key: string, path: string) => api(`/api/v1${path}`, { headers: { authorization: `Bearer ${key}` } });

const now = new Date();
const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12));
const lastMonth = lastMonthDate.toISOString().slice(0, 7);

async function makeKey(session: typeof alice.session, userId: string, name: string) {
  const response = await api("/api/admin/api-keys", {
    session,
    json: { name, userId, projectIds: [project.id], platforms: ["replicate"] },
  });
  expect(response.status).toBe(201);
  return { secret: response.data.secret as string, id: (response.data.key as { id: string }).id };
}

async function runToEnd(key: string) {
  const started = await api("/api/v1/generations", {
    headers: { authorization: `Bearer ${key}` },
    json: { model: "google/nano-banana", input: { prompt: "a red bicycle" } },
  });
  expect(started.status).toBe(202);
  const id = started.data.id as string;
  await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
  for (let i = 0; i < 100; i++) {
    const current = await v1(key, `/generations/${id}`);
    if (current.data.status === "succeeded" && current.data.output) return id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${id} never settled`);
}

beforeAll(async () => {
  const root = await loginRoot();
  const admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);

  ({ secret, id: keyId } = await makeKey(admin.session, alice.id, "Acme =site"));
  ({ secret: bobsSecret } = await makeKey(admin.session, bob.id, "Bob"));

  await runToEnd(secret);
  await runToEnd(secret);
  await runToEnd(bobsSecret);

  // One unpriced run this month and one priced run last
  // month, straight into the ledger
  const expenses = (await db()).collection("expenses");
  const base = { userId: alice.id, userName: "alice", projectId: project.id, projectName: project.name, provider: "replicate", currency: "USD", pricingSource: "estimated", apiKeyId: keyId, apiKeyName: "Acme =site", createdAt: now };
  await expenses.insertMany([
    { _id: "billing-unpriced" as never, ...base, generationId: "gen-unpriced", model: "someone/new-model", amountUsd: null, incurredAt: now },
    { _id: "billing-last-month" as never, ...base, generationId: "gen-old", model: "google/nano-banana", amountUsd: 1.5, incurredAt: lastMonthDate },
  ]);
});

afterAll(closeDb);

describe("billing summary", () => {
  it("totals this month by platform, model, project and day, with the cap", async () => {
    const summary = await v1(secret, "/billing");
    expect(summary.status).toBe(200);
    expect(summary.data).toMatchObject({
      object: "billing_summary",
      key: { id: keyId, name: "Acme =site" },
      period: { label: thisMonth },
      currency: "USD",
      runs: 3,
      unpricedRuns: 1,
      cap: null,
      inFlight: { runs: 0 },
    });
    expect(summary.data.totalUsd).toBeGreaterThan(0);
    expect(summary.data.byPlatform).toEqual([expect.objectContaining({ id: "replicate", runs: 3, unpricedRuns: 1 })]);
    const models = summary.data.byModel as { id: string; runs: number; unpricedRuns: number }[];
    expect(models.find((row) => row.id === "google/nano-banana")).toMatchObject({ runs: 2, unpricedRuns: 0 });
    expect(models.find((row) => row.id === "someone/new-model")).toMatchObject({ runs: 1, unpricedRuns: 1 });
    expect(summary.data.byProject).toEqual([expect.objectContaining({ id: project.id, name: project.name, runs: 3 })]);
    const days = summary.data.byDay as { date: string; runs: number }[];
    expect(days.reduce((sum, day) => sum + day.runs, 0)).toBe(3);
    expect(days[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads a past month or a date range, without the cap", async () => {
    const past = await v1(secret, `/billing?month=${lastMonth}`);
    expect(past.data).toMatchObject({ period: { label: lastMonth }, totalUsd: 1.5, runs: 1, cap: null, inFlight: null });

    const day = lastMonthDate.toISOString().slice(0, 10);
    const range = await v1(secret, `/billing?from=${day}&to=${day}`);
    expect(range.data).toMatchObject({ period: { label: `${day}..${day}` }, totalUsd: 1.5, runs: 1 });
  });

  it("checks the period", async () => {
    for (const query of ["month=2026-13", "month=2026-11&from=2026-11-01&to=2026-11-02", "from=2026-11-01", "from=2026-11-05&to=2026-11-01", "from=2026-02-30&to=2026-03-01", "from=2024-01-01&to=2026-01-01"]) {
      const response = await v1(secret, `/billing?${query}`);
      expect(response.status, query).toBe(400);
      expect((response.data.error as { code: string }).code).toBe("invalid_request");
    }
  });

  it("needs a key, and shows another key nothing of this one", async () => {
    expect((await api("/api/v1/billing")).status).toBe(401);
    expect((await api("/api/v1/billing", { session: alice.session })).status).toBe(401);
    const bobs = await v1(bobsSecret, "/billing");
    expect(bobs.data).toMatchObject({ runs: 1, unpricedRuns: 0 });
    expect((await v1(bobsSecret, `/billing?month=${lastMonth}`)).data).toMatchObject({ runs: 0, totalUsd: 0 });
  });
});

describe("charges", () => {
  it("lists one charge per run, newest first, page by page", async () => {
    const first = await v1(secret, "/billing/charges?limit=2");
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ object: "list", period: thisMonth });
    const page = first.data.data as { id: string; incurredAt: string }[];
    expect(page).toHaveLength(2);
    expect(page[0].incurredAt >= page[1].incurredAt).toBe(true);
    expect(first.data.nextCursor).toBeTruthy();

    const second = await v1(secret, `/billing/charges?limit=2&cursor=${first.data.nextCursor}`);
    const rest = second.data.data as { id: string }[];
    expect(rest).toHaveLength(1);
    expect(second.data.nextCursor).toBeNull();
    expect(new Set([...page, ...rest].map((charge) => charge.id)).size).toBe(3);
  });

  it("shows each charge's run, model, project and price, unpriced ones as null", async () => {
    const all = (await v1(secret, "/billing/charges")).data.data as Record<string, unknown>[];
    const unpriced = all.find((charge) => charge.id === "billing-unpriced");
    expect(unpriced).toEqual({
      id: "billing-unpriced",
      object: "charge",
      generationId: "gen-unpriced",
      platform: "replicate",
      model: "someone/new-model",
      project: { id: project.id, name: project.name },
      amountUsd: null,
      currency: "USD",
      priced: false,
      pricingSource: "estimated",
      incurredAt: expect.any(String),
    });
    const priced = all.filter((charge) => charge.priced);
    expect(priced).toHaveLength(2);
    for (const charge of priced) expect(charge.amountUsd).toBeGreaterThan(0);
  });

  it("filters by model and platform, and only ever lists this key's charges", async () => {
    const byModel = (await v1(secret, "/billing/charges?model=someone/new-model")).data.data as unknown[];
    expect(byModel).toHaveLength(1);
    expect(((await v1(secret, "/billing/charges?platform=elevenlabs")).data.data as unknown[]).length).toBe(0);
    expect((await v1(secret, "/billing/charges?platform=stripe")).status).toBe(400);
    const bobs = (await v1(bobsSecret, "/billing/charges")).data.data as { id: string }[];
    expect(bobs).toHaveLength(1);
    expect(bobs.map((charge) => charge.id)).not.toContain("billing-unpriced");
  });
});

describe("months and statements", () => {
  it("gives a total for each recent month, empty ones at $0", async () => {
    const months = await v1(secret, "/billing/months?count=3");
    expect(months.status).toBe(200);
    const data = months.data.data as { month: string; totalUsd: number; runs: number }[];
    expect(data.map((row) => row.month)[0]).toBe(thisMonth);
    expect(data).toHaveLength(3);
    expect(data[0].runs).toBe(3);
    expect(data[1]).toMatchObject({ month: lastMonth, totalUsd: 1.5, runs: 1 });
    expect(data[2]).toMatchObject({ totalUsd: 0, runs: 0 });
    expect((await v1(secret, "/billing/months?count=0")).status).toBe(400);
    expect((await v1(secret, "/billing/months?count=40")).status).toBe(400);
  });

  it("downloads the month as CSV, safe to open in a spreadsheet", async () => {
    const response = await fetch(`${baseUrl}/api/v1/billing/statement?month=${thisMonth}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="naar-studio-Acme-site-${thisMonth}.csv"`);
    expect(response.headers.get("x-statement-truncated")).toBe("false");
    const lines = (await response.text()).trim().split("\r\n");
    expect(lines[0]).toBe("incurred_at,charge_id,generation_id,platform,model,project_id,project,amount_usd,priced,pricing_source");
    expect(lines).toHaveLength(4);
    expect(lines.find((line) => line.includes("billing-unpriced"))).toContain(",,no,estimated");
  });

  it("gives the statement as JSON too, and checks the format", async () => {
    const json = await v1(secret, `/billing/statement?month=${lastMonth}&format=json`);
    expect(json.data).toMatchObject({ object: "statement", totalUsd: 1.5, runs: 1, truncated: false });
    expect(json.data.charges).toHaveLength(1);
    expect((await v1(secret, "/billing/statement?format=pdf")).status).toBe(400);
  });
});

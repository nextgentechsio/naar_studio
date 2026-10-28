import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, db, loginRoot } from "./helpers";

// --------------------------------------------------
// Dashboard cost analytics: spend per day (viewer's
// timezone) and platform, breakdowns, previous period,
// top runs and run outcomes, scoped to the viewer.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

const DAY = 24 * 60 * 60 * 1000;
// A fixed period: 10 Oct 00:00 to 13 Oct 00:00, Kolkata
// time (UTC+5:30), so day buckets are checkable
const from = new Date("2026-10-09T18:30:00.000Z");
const to = new Date("2026-10-12T18:30:00.000Z");
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  const database = await db();

  const expense = (id: string, userId: string, provider: string | null, model: string, amountUsd: number | null, incurredAt: Date) => ({
    _id: id,
    generationId: id,
    userId,
    userName: userId === alice.id ? alice.username : bob.username,
    projectId: "p-analytics",
    projectName: "Analytics",
    ...(provider ? { provider } : {}),
    model,
    amountUsd,
    currency: "USD",
    pricingSource: "estimated",
    incurredAt,
    createdAt: incurredAt,
  });

  const tag = Date.now().toString(36);
  await database.collection("expenses").insertMany([
    // 10 Oct 23:00 Kolkata = 17:30 UTC: still the 10th there
    expense(`a1-${tag}`, alice.id, "replicate", "google/nano-banana", 0.04, at("2026-10-10T17:30:00Z")),
    // Old entry with no provider: Replicate's, on the 11th
    expense(`a2-${tag}`, alice.id, null, "google/nano-banana", 0.06, at("2026-10-11T04:00:00Z")),
    expense(`a3-${tag}`, alice.id, "higgsfield", "bytedance/seedance-2.5/video-edit", 1.5, at("2026-10-11T06:00:00Z")),
    expense(`a4-${tag}`, alice.id, "higgsfield", "kling-video/v3/motion-control/pro", null, at("2026-10-12T06:00:00Z")),
    // The period before (same length)
    expense(`a5-${tag}`, alice.id, "replicate", "google/nano-banana", 0.8, at("2026-10-08T06:00:00Z")),
    // Outside both; and Bob's, never Alice's
    expense(`a6-${tag}`, alice.id, "replicate", "google/nano-banana", 9, at("2026-09-01T06:00:00Z")),
    expense(`b1-${tag}`, bob.id, "higgsfield", "bytedance/seedance-2.5/video-edit", 7, at("2026-10-11T06:00:00Z")),
  ] as never[]);

  const run = (id: string, status: string, provider: string, createdAt: Date, extra: Record<string, unknown> = {}) => ({
    _id: id, userId: alice.id, userName: alice.username, projectId: "p-analytics", projectName: "Analytics",
    provider, model: "google/nano-banana", version: "", prompt: "x", inputs: {}, inputImage: null, aspectRatio: "",
    resolution: "", status, error: null, costUsd: null, outputUrl: null, localOutputUrl: null, predictTime: null,
    createdAt, updatedAt: createdAt, completedAt: createdAt, ...extra,
  });
  await database.collection("generations").insertMany([
    // Succeeded runs share their expense's id (else the
    // ledger backfill would add one for them)
    run(`a1-${tag}`, "succeeded", "replicate", at("2026-10-10T06:00:00Z")),
    run(`a3-${tag}`, "succeeded", "higgsfield", at("2026-10-11T06:00:00Z")),
    run(`g3-${tag}`, "failed", "higgsfield", at("2026-10-11T07:00:00Z")),
    // Hidden: not Alice's to see
    run(`g4-${tag}`, "failed", "replicate", at("2026-10-11T08:00:00Z"), { hiddenAt: new Date() }),
  ] as never[]);
});

afterAll(closeDb);

const analytics = (session: typeof alice.session, extra = "") =>
  api(
    `/api/expenses/analytics?from=${from.toISOString()}&to=${to.toISOString()}&monthStart=${new Date("2026-09-30T18:30:00Z").toISOString()}&tz=Asia/Kolkata${extra}`,
    { session },
  );

describe("cost analytics", () => {
  it("adds up the period, the one before, and by platform", async () => {
    const { status, data } = await analytics(alice.session);
    expect(status).toBe(200);

    expect(data.total).toEqual({ amountUsd: 1.6, count: 4, unpriced: 1 });
    expect(data.previous).toEqual({ amountUsd: 0.8, count: 1, unpriced: 0 });
    expect((data.byProvider as { replicate: { amountUsd: number } }).replicate.amountUsd).toBeCloseTo(0.1, 6);
    expect((data.byProvider as { higgsfield: { count: number } }).higgsfield.count).toBe(2);
  });

  it("buckets days in the viewer's timezone", async () => {
    const { data } = await analytics(alice.session);
    const days = data.days as { day: string; replicate: number; higgsfield: number; runs: number }[];
    expect(days.map((day) => day.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(days[0]).toMatchObject({ replicate: 0.04, higgsfield: 0, runs: 1 });
    expect(days[1].replicate).toBeCloseTo(0.06, 6);
    expect(days[1]).toMatchObject({ higgsfield: 1.5, runs: 2 });
    expect(days[2]).toMatchObject({ higgsfield: 0, runs: 1 });
  });

  it("breaks spend down by model, with per-run costs, and lists the top runs", async () => {
    const { data } = await analytics(alice.session);
    const models = data.byModel as { model: string; provider: string; runs: number; amountUsd: number; unpriced: number; averageUsd: number | null }[];
    expect(models[0]).toMatchObject({ model: "bytedance/seedance-2.5/video-edit", provider: "higgsfield", runs: 1, amountUsd: 1.5, averageUsd: 1.5 });
    expect(models.find((row) => row.model === "google/nano-banana")).toMatchObject({ provider: "replicate", runs: 2, averageUsd: 0.05 });
    expect(models.find((row) => row.model.includes("motion-control"))).toMatchObject({ unpriced: 1, averageUsd: null });

    const top = data.topRuns as { amountUsd: number }[];
    expect(top.map((run) => run.amountUsd)).toEqual([1.5, 0.06, 0.04]);
  });

  it("counts run outcomes, without hidden runs for non super admins", async () => {
    const { data } = await analytics(alice.session);
    expect(data.outcomes).toEqual({ total: 3, succeeded: 2, failed: 1, running: 0 });
  });

  it("filters by platform and keeps each user's spend private", async () => {
    const higgsfield = await analytics(alice.session, "&provider=higgsfield");
    expect(higgsfield.data.total).toMatchObject({ amountUsd: 1.5, count: 2 });
    expect(higgsfield.data.outcomes).toMatchObject({ total: 2, failed: 1 });

    const bobs = await analytics(bob.session);
    expect(bobs.data.total).toMatchObject({ amountUsd: 7, count: 1 });
  });

  it("refuses bad periods and signed-out requests", async () => {
    expect((await api(`/api/expenses/analytics?from=${to.toISOString()}&to=${from.toISOString()}`, { session: alice.session })).status).toBe(400);
    expect((await api(`/api/expenses/analytics?from=${new Date(to.getTime() - 500 * DAY).toISOString()}&to=${to.toISOString()}`, { session: alice.session })).status).toBe(400);
    expect((await api("/api/expenses/analytics")).status).toBe(401);
  });
});

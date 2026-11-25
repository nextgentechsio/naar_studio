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
  type Session,
} from "./helpers";

// --------------------------------------------------
// Project budgets: a total and/or monthly budget per
// project. Runs that would pass it are refused (counting
// runs still going), and admins plus everyone working in
// the project are notified at 80% and 100%.
// --------------------------------------------------

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

// $0.151 a run (our price table)
const MODEL = "google/nano-banana-2";
const INPUTS = { prompt: "a lighthouse", resolution: "4K" };

const run = (session: Session) => api("/api/generate", { session, json: { project: project.name, model: MODEL, inputs: INPUTS } });
const setBudget = (session: Session, json: Record<string, unknown>) =>
  api(`/api/project-budgets/${project.id}`, { session, method: "PUT", json });

async function finish(id: string) {
  await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()], metrics: { predict_time: 1 } });
  expect((await pollPrediction(alice.session, id)).data.costUsd).toBe(0.151);
}

// Spend from elsewhere in the project, straight into the
// ledger
async function addSpend(amountUsd: number, incurredAt = new Date()) {
  const id = `budget-test-${Math.random().toString(36).slice(2)}`;
  await (await db()).collection("expenses").insertOne({
    _id: id as never,
    generationId: id,
    userId: alice.id,
    userName: "alice",
    projectId: project.id,
    projectName: project.name,
    provider: "replicate",
    model: MODEL,
    amountUsd,
    currency: "USD",
    pricingSource: "estimated",
    incurredAt,
    createdAt: new Date(),
  });
}

// The budget alerts a user has (sent in the background)
async function alerts(session: Session, wanted: number) {
  let titles: string[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await api("/api/notifications", { session });
    titles = (list.data.notifications as { title: string }[]).map((item) => item.title).filter((title) => title.includes(project.name));
    if (titles.length >= wanted) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return titles;
}

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
  // The super admin makes this admin the budget manager
  expect((await api("/api/project-budgets/managers", { session: root, method: "PUT", json: { userIds: [admin.id] } })).status).toBe(200);
});

afterAll(closeDb);

describe("who can set budgets", () => {
  it("only the budget managers the super admin chose; others only see them", async () => {
    const other = await createUser(root, "admin");

    // Not the super admin, nor another admin
    expect((await setBudget(root, { totalUsd: 10 })).status).toBe(403);
    const refused = await setBudget(other.session, { totalUsd: 10 });
    expect(refused.status).toBe(403);
    expect(refused.data.error).toMatch(/Only the budget manager/);

    // Everyone on the page sees who it is, and whether they may
    const asOther = await api("/api/project-budgets", { session: other.session });
    expect(asOther.data).toMatchObject({ canEdit: false, managers: [{ id: admin.id }] });
    expect(asOther.data.candidates).toBeUndefined();
    const asManager = await api("/api/project-budgets", { session: admin.session });
    expect(asManager.data.canEdit).toBe(true);
    const asRoot = await api("/api/project-budgets", { session: root });
    expect(asRoot.data.canEdit).toBe(false);
    expect((asRoot.data.candidates as { id: string }[]).map((c) => c.id)).toEqual(expect.arrayContaining([admin.id, other.id]));
  });

  it("are chosen by the super admin only, from active admins", async () => {
    const managers = (session: Session, userIds: unknown) =>
      api("/api/project-budgets/managers", { session, method: "PUT", json: { userIds } });
    expect((await managers(admin.session, [admin.id])).status).toBe(403);
    expect((await managers(root, [alice.id])).status).toBe(400);
    expect((await managers(root, ["no-such-user"])).status).toBe(400);
    expect((await managers(root, "everyone")).status).toBe(400);

    // Handing over: the old manager can't any more
    const next = await createUser(root, "admin");
    expect((await managers(root, [next.id])).status).toBe(200);
    expect((await setBudget(admin.session, { totalUsd: 10 })).status).toBe(403);
    expect((await setBudget(next.session, { totalUsd: 10 })).status).toBe(200);

    // A disabled manager can't either
    expect((await api(`/api/users/${next.id}`, { session: root, method: "PATCH", json: { disabled: true } })).status).toBe(200);
    expect((await api("/api/project-budgets", { session: admin.session })).data.managers).toEqual([]);

    // Back to the first one (the tests below)
    const saved = await managers(root, [admin.id]);
    expect(saved.data.managers).toEqual([expect.objectContaining({ id: admin.id })]);
    expect((await setBudget(admin.session, { totalUsd: null, monthlyUsd: null })).status).toBe(200);
  });
});

describe("setting a budget", () => {
  it("is for admins, with amounts in dollars", async () => {
    expect((await setBudget(alice.session, { totalUsd: 10 })).status).toBe(403);
    for (const totalUsd of [0, -5, "ten", 2_000_000]) {
      expect((await setBudget(admin.session, { totalUsd })).status, String(totalUsd)).toBe(400);
    }
    expect((await api("/api/project-budgets/no-such-project", { session: admin.session, method: "PUT", json: { totalUsd: 5 } })).status).toBe(404);

    const saved = await setBudget(admin.session, { totalUsd: "$12.345", monthlyUsd: "" });
    expect(saved.status).toBe(200);
    expect(saved.data.budget).toMatchObject({ projectId: project.id, totalUsd: 12.35, monthlyUsd: null });

    const list = await api("/api/project-budgets", { session: admin.session });
    expect((list.data.budgets as { projectId: string }[]).find((item) => item.projectId === project.id)).toMatchObject({
      totalUsd: 12.35,
      usage: { totalSpentUsd: 0, monthSpentUsd: 0, inFlight: 0 },
    });
    expect((await api("/api/project-budgets", { session: alice.session })).status).toBe(403);
  });
});

describe("the total budget", () => {
  it("refuses a run that would go over it, counting runs still going", async () => {
    expect((await setBudget(admin.session, { totalUsd: 0.2, monthlyUsd: null })).status).toBe(200);

    const first = await run(alice.session);
    expect(first.status).toBe(200);
    const firstId = (first.data.tracking as { predictionId: string }).predictionId;

    // $0.151 going + $0.151 more would pass $0.20
    const second = await run(alice.session);
    expect(second.status).toBe(402);
    expect(second.data.error).toMatch(/would take project .* over its total budget of \$0\.20/);
    expect(second.data.error).toMatch(/in runs still going/);

    await finish(firstId);
    const list = await api("/api/project-budgets", { session: admin.session });
    expect((list.data.budgets as { projectId: string }[]).find((item) => item.projectId === project.id)).toMatchObject({
      usage: { totalSpentUsd: 0.151, inFlight: 0, inFlightUsd: 0 },
    });
  });

  it("notifies at 80% and at 100%, once each, to admins and the project's people", async () => {
    // $1 budget: $0.151 so far, plus $0.65 from elsewhere
    expect((await setBudget(admin.session, { totalUsd: 1 })).status).toBe(200);
    await addSpend(0.65);

    // This run brings it to $0.952 (95%)
    const started = await run(alice.session);
    expect(started.status).toBe(200);
    await finish((started.data.tracking as { predictionId: string }).predictionId);
    expect(await alerts(alice.session, 1)).toEqual([`"${project.name}" has used 95% of its total budget`]);

    // Another $0.151 would pass $1
    const over = await run(alice.session);
    expect(over.status).toBe(402);
    expect(over.data.error).toMatch(/would take project/);

    // At the budget: refused outright, and the 100% alert
    await addSpend(0.05);
    const reached = await run(alice.session);
    expect(reached.status).toBe(402);
    expect(reached.data.error).toMatch(/has reached its total budget of \$1\.00 \(\$1\.00 spent\)/);

    const titles = await alerts(alice.session, 2);
    expect(titles.sort()).toEqual([`"${project.name}" has used 95% of its total budget`, `"${project.name}" reached its total budget`]);
    expect((await alerts(admin.session, 2)).length).toBe(2);
    expect(await alerts(root, 2)).toHaveLength(2);
    // Bob never worked in this project
    expect(await alerts(bob.session, 0)).toEqual([]);

    // Refused again: no more alerts
    await run(alice.session);
    expect(await alerts(alice.session, 3)).toHaveLength(2);
  });

  it("lets runs through again once raised", async () => {
    expect((await setBudget(admin.session, { totalUsd: 5 })).status).toBe(200);
    const started = await run(alice.session);
    expect(started.status).toBe(200);
    await finish((started.data.tracking as { predictionId: string }).predictionId);
  });
});

describe("the monthly budget", () => {
  it("counts this month only", async () => {
    // Everything so far moves to last month
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await (await db()).collection("expenses").updateMany({ projectId: project.id }, { $set: { incurredAt: lastMonth } });

    expect((await setBudget(admin.session, { totalUsd: null, monthlyUsd: 0.1 })).status).toBe(200);
    const refused = await run(alice.session);
    expect(refused.status).toBe(402);
    expect(refused.data.error).toMatch(/over its budget for this month of \$0\.10 \(\$0\.00 spent/);

    expect((await setBudget(admin.session, { monthlyUsd: 0.5 })).status).toBe(200);
    const started = await run(alice.session);
    expect(started.status).toBe(200);
    await finish((started.data.tracking as { predictionId: string }).predictionId);
  });

  it("no budget: no limit", async () => {
    const cleared = await setBudget(admin.session, { totalUsd: null, monthlyUsd: null });
    expect(cleared.data.budget).toMatchObject({ totalUsd: null, monthlyUsd: null, updatedAt: null });
    expect(await (await db()).collection("projectBudgets").countDocuments({ _id: project.id as never })).toBe(0);
  });
});

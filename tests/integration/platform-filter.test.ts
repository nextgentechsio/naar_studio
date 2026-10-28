import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  closeDb,
  createProject,
  db,
  fakeOutputUrl,
  loginRoot,
  pollPrediction,
  setPrediction,
  startGeneration,
  type Session,
} from "./helpers";

// --------------------------------------------------
// The platform filter on Expenses and the Dashboard
// (whose numbers come from the expenses report and the
// History list): Replicate, Higgsfield, or both. Older
// records with no provider are Replicate's.
// --------------------------------------------------

let root: Session;
let project: { id: string; name: string };
let replicateId = "";
const higgsfieldId = `hf-${Date.now().toString(36)}`;

beforeAll(async () => {
  root = await loginRoot();
  project = await createProject(root);

  replicateId = await startGeneration(root, project.name);
  await setPrediction(replicateId, { status: "succeeded", output: [fakeOutputUrl()] });
  await pollPrediction(root, replicateId);

  // A finished Higgsfield run and its expense, as the app
  // records them
  const database = await db();
  const now = new Date();
  const base = await database.collection("generations").findOne({ _id: replicateId as never });
  await database.collection("generations").insertOne({
    ...base,
    _id: higgsfieldId as never,
    provider: "higgsfield",
    model: "bytedance/seedance-2.5/text-to-video",
    costUsd: 1.25,
    createdAt: now,
  });
  const expense = await database.collection("expenses").findOne({ _id: replicateId as never });
  await database.collection("expenses").insertOne({
    ...expense,
    _id: higgsfieldId as never,
    generationId: higgsfieldId,
    provider: "higgsfield",
    model: "bytedance/seedance-2.5/text-to-video",
    amountUsd: 1.25,
    incurredAt: now,
  });
  // An old Replicate expense with no provider at all
  await database.collection("expenses").updateOne({ _id: replicateId as never }, { $unset: { provider: "" } });
});

afterAll(closeDb);

const spend = async (platform = "") =>
  (await api(`/api/expenses?project=${project.id}${platform ? `&provider=${platform}` : ""}`, { session: root })).data as {
    totals: { allTime: { amountUsd: number; count: number } };
  };

const runs = async (platform = "") =>
  ((await api(`/api/generations?options=0&project=${project.id}${platform ? `&provider=${platform}` : ""}`, { session: root }))
    .data.generations as { id: string }[]).map((item) => item.id);

describe("platform filter", () => {
  it("splits Expenses totals by platform", async () => {
    const all = await spend();
    const higgsfield = await spend("higgsfield");
    const replicate = await spend("replicate");

    expect(all.totals.allTime.count).toBe(2);
    expect(higgsfield.totals.allTime).toMatchObject({ count: 1, amountUsd: 1.25 });
    // The expense with no provider counts as Replicate
    expect(replicate.totals.allTime.count).toBe(1);
    expect(replicate.totals.allTime.amountUsd + higgsfield.totals.allTime.amountUsd).toBeCloseTo(all.totals.allTime.amountUsd, 6);
  });

  it("splits the run list by platform", async () => {
    expect((await runs()).sort()).toEqual([replicateId, higgsfieldId].sort());
    expect(await runs("higgsfield")).toEqual([higgsfieldId]);
    expect(await runs("replicate")).toEqual([replicateId]);
    // Anything else is ignored
    expect(await runs("nope")).toHaveLength(2);
  });
});

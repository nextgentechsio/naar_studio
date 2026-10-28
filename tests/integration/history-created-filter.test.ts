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
} from "./helpers";

// --------------------------------------------------
// History's Created filter: from (inclusive) and to
// (exclusive) instants, as the browser sends them.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };
const ids: Record<string, string> = {};
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  project = await createProject(root);

  // Three runs: 10 days ago, yesterday, now
  for (const [name, age] of [["old", 10 * DAY], ["yesterday", DAY], ["now", 0]] as const) {
    const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: name });
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await pollPrediction(alice.session, id);
    await (await db()).collection("generations").updateOne({ _id: id as never }, { $set: { createdAt: new Date(now - age) } });
    ids[name] = id;
  }
});

afterAll(closeDb);

const listed = async (query: string) =>
  ((await api(`/api/generations?options=0&pageSize=60&project=${project.id}${query}`, { session: alice.session }))
    .data.generations as { id: string }[]).map((item) => item.id);

describe("History's Created filter", () => {
  it("keeps runs from `from` on", async () => {
    const from = new Date(now - 2 * DAY).toISOString();
    expect(await listed(`&from=${from}`)).toEqual([ids.now, ids.yesterday]);
  });

  it("keeps runs before `to`", async () => {
    const to = new Date(now - 2 * DAY).toISOString();
    expect(await listed(`&to=${to}`)).toEqual([ids.old]);
  });

  it("combines both, and ignores dates it can't read", async () => {
    const from = new Date(now - 2 * DAY).toISOString();
    const to = new Date(now - DAY / 2).toISOString();
    expect(await listed(`&from=${from}&to=${to}`)).toEqual([ids.yesterday]);
    expect(await listed("&from=not-a-date")).toHaveLength(3);
  });
});

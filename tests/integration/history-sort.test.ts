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
// History's sort (?sort=): by date, by gen time (the
// provider's, else start to finish) and by cost; runs
// without the value go last. Paging stays consistent.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };
const ids: Record<string, string> = {};
const now = Date.now();

// name: age in minutes, provider time, wall time (s), cost
const RUNS = [
  ["a", 40, 7.5, null, 0.04],
  ["b", 30, null, 90, 0.2],
  ["c", 20, 3, null, null],
  ["d", 10, null, null, 0.01],
] as const;

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  project = await createProject(root);

  for (const [name, age, predictTime, wall, cost] of RUNS) {
    const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: name });
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await pollPrediction(alice.session, id);
    const createdAt = new Date(now - age * 60_000);
    await (await db()).collection("generations").updateOne(
      { _id: id as never },
      {
        $set: {
          createdAt,
          predictTime,
          // "d" is still running: no end, no time
          completedAt: name === "d" ? null : new Date(createdAt.getTime() + (wall ?? 1) * 1000),
          costUsd: cost,
        },
      }
    );
    ids[name] = id;
  }
});

afterAll(closeDb);

const listed = async (query: string) => {
  const response = await api(`/api/generations?options=0&pageSize=60&project=${project.id}${query}`, {
    session: alice.session,
  });
  expect(response.status).toBe(200);
  return (response.data.generations as { id: string }[]).map((item) => item.id);
};
const named = (...names: string[]) => names.map((name) => ids[name]);

describe("History's sort", () => {
  it("lists newest first by default, oldest when asked", async () => {
    expect(await listed("")).toEqual(named("d", "c", "b", "a"));
    expect(await listed("&sort=newest")).toEqual(named("d", "c", "b", "a"));
    expect(await listed("&sort=oldest")).toEqual(named("a", "b", "c", "d"));
  });

  it("sorts by gen time, falling back to start to finish, unknown last", async () => {
    expect(await listed("&sort=longest")).toEqual(named("b", "a", "c", "d"));
    expect(await listed("&sort=shortest")).toEqual(named("c", "a", "b", "d"));
  });

  it("sorts by cost, no cost last", async () => {
    expect(await listed("&sort=costly")).toEqual(named("b", "a", "d", "c"));
    expect(await listed("&sort=cheap")).toEqual(named("d", "a", "b", "c"));
  });

  it("pages the sorted list without overlap, and ignores an unknown sort", async () => {
    const pages = [];
    for (const page of [1, 2]) {
      const response = await api(
        `/api/generations?options=0&pageSize=2&page=${page}&project=${project.id}&sort=costly`,
        { session: alice.session }
      );
      pages.push(...(response.data.generations as { id: string }[]).map((item) => item.id));
    }
    expect(pages).toEqual(named("b", "a", "d", "c"));
    expect(await listed("&sort=bogus")).toEqual(named("d", "c", "b", "a"));
  });
});

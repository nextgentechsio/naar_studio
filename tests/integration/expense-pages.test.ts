import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, db, loginRoot } from "./helpers";

// --------------------------------------------------
// Numbered pages of the expense history: 50 a page,
// newest first, no overlaps or gaps; the report's
// "selected" count gives the number of pages.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
const ids: string[] = [];

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");

  const now = Date.now();
  const docs = Array.from({ length: 120 }, (_, index) => {
    const at = new Date(now - index * 60_000);
    const id = `page-${alice.id}-${String(index).padStart(3, "0")}`;
    ids.push(id);
    return {
      _id: id, generationId: id, userId: alice.id, userName: alice.username,
      projectId: "p-pages", projectName: "Pages", provider: "replicate", model: "google/nano-banana",
      amountUsd: 0.01, currency: "USD", pricingSource: "estimated", incurredAt: at, createdAt: at,
    };
  });
  await (await db()).collection("expenses").insertMany(docs as never[]);
});

afterAll(closeDb);

const page = async (number: number) =>
  ((await api(`/api/expenses/entries?page=${number}`, { session: alice.session })).data.entries as { id: string }[]).map(
    (entry) => entry.id,
  );

describe("expense history pages", () => {
  it("splits the history into pages of 50, newest first", async () => {
    const report = await api("/api/expenses", { session: alice.session });
    expect((report.data.totals as { selected: { count: number } }).selected.count).toBe(120);
    expect((report.data.entries as unknown[]).length).toBe(50);

    const [one, two, three, four] = [await page(1), await page(2), await page(3), await page(4)];
    expect(one).toEqual(ids.slice(0, 50));
    expect(two).toEqual(ids.slice(50, 100));
    expect(three).toEqual(ids.slice(100));
    expect(four).toEqual([]);
  });

  it("treats a missing or nonsense page as the first", async () => {
    const first = await page(1);
    for (const value of ["0", "-3", "abc", "Infinity"]) {
      const ids = ((await api(`/api/expenses/entries?page=${value}`, { session: alice.session })).data.entries as { id: string }[]).map((entry) => entry.id);
      expect(ids, value).toEqual(first);
    }
  });
});

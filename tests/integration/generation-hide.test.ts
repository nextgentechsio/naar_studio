import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  closeDb,
  createProject,
  createUser,
  fakeOutputUrl,
  loginRoot,
  pollPrediction,
  setPrediction,
  startGeneration,
  type Session,
} from "./helpers";

// --------------------------------------------------
// Hiding a run: the super admin hides it from everyone
// else (owner and admins included) and still sees it.
// --------------------------------------------------

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let project: { name: string };

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const hide = (session: Session, id: string, hidden: unknown) =>
  api(`/api/generations/${encodeURIComponent(id)}`, { session, method: "PATCH", json: { hidden } });

const listed = async (session: Session, query = "") =>
  ((await api(`/api/generations?pageSize=60${query}`, { session })).data.generations as {
    id: string;
    hidden: boolean;
  }[]);

describe("hiding a run", () => {
  it("hides it from everyone but the super admin, and shows it again", async () => {
    const prompt = `hide-me-${Date.now()}`;
    const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt });
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await pollPrediction(alice.session, id);
    const detail = await api(`/api/generations/${id}`, { session: alice.session });
    const outputUrl = (detail.data.generation as { outputUrl: string }).outputUrl;
    expect(outputUrl).toBeTruthy();

    // Only the super admin may hide
    expect((await hide(alice.session, id, true)).status).toBe(403);
    expect((await hide(admin.session, id, true)).status).toBe(403);
    expect((await hide(root, id, "yes")).status).toBe(400);

    expect((await hide(root, id, true)).status).toBe(200);

    // Owner and admin: gone everywhere
    for (const session of [alice.session, admin.session]) {
      expect((await listed(session)).some((item) => item.id === id)).toBe(false);
      expect((await listed(session, `&q=${prompt}`))).toEqual([]);
      expect((await api(`/api/generations/${id}`, { session })).status).toBe(404);
      expect((await api(outputUrl, { session })).status).toBe(404);
      expect((await api(`/api/predictions/${id}`, { session })).status).toBe(404);
      // Asking for hidden runs does nothing for them
      expect((await listed(session, "&status=hidden")).some((item) => item.id === id)).toBe(false);
    }

    // Super admin: still sees it, marked, and can filter
    expect((await listed(root)).find((item) => item.id === id)?.hidden).toBe(true);
    expect((await listed(root, "&status=hidden")).map((item) => item.id)).toContain(id);
    expect((await api(`/api/generations/${id}`, { session: root })).status).toBe(200);
    expect((await api(outputUrl, { session: root })).status).toBe(200);

    // Unhide: back for everyone
    expect((await hide(root, id, false)).status).toBe(200);
    expect((await listed(alice.session)).find((item) => item.id === id)?.hidden).toBe(false);
    expect((await api(outputUrl, { session: alice.session })).status).toBe(200);
  });

  it("keeps its cost in Expenses", async () => {
    const id = await startGeneration(alice.session, project.name);
    await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
    await pollPrediction(alice.session, id);
    const before = (await api("/api/expenses", { session: root })).data;

    expect((await hide(root, id, true)).status).toBe(200);
    expect((await api("/api/expenses", { session: root })).data).toEqual(before);
  });

  it("refuses runs still going and unknown ids", async () => {
    const running = await startGeneration(alice.session, project.name);
    expect((await hide(root, running, true)).status).toBe(409);
    expect((await hide(root, "no-such-run", true)).status).toBe(404);
  });
});

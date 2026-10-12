import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  closeDb,
  createProject,
  createUser,
  fakeOutputUrl,
  loginRoot,
  replicateRequests,
  setPrediction,
  startGeneration,
  type Session,
} from "./helpers";

let root: Session;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function finish(session: Session, id: string, status = "succeeded") {
  await setPrediction(id, { status, output: status === "succeeded" ? [fakeOutputUrl()] : null });
  await api(`/api/predictions/${id}`, { session });
}

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);

  // Alice: 3 succeeded + 1 failed; Bob: 1 succeeded
  for (const prompt of ["red cat", "blue dog", "green bird"]) {
    await finish(alice.session, await startGeneration(alice.session, project.name, "google/nano-banana", { prompt }));
  }
  await finish(alice.session, await startGeneration(alice.session, project.name), "failed");
  await finish(bob.session, await startGeneration(bob.session, project.name, "google/nano-banana", { prompt: "bob's secret" }));
});

afterAll(closeDb);

describe("history", () => {
  const history = (session: Session, query = "") => api(`/api/generations?${query}`, { session });

  it("users only ever see their own runs", async () => {
    const { data } = await history(alice.session, "pageSize=60");
    const prompts = (data.generations as { prompt: string }[]).map((item) => item.prompt);

    expect(prompts).not.toContain("bob's secret");
    expect(data.options).toMatchObject({ users: [] });

    // Trying to filter by Bob doesn't leak his runs
    const bobId = bob.id;
    const filtered = await history(alice.session, `user=${bobId}`);
    expect((filtered.data.generations as unknown[]).length).toBe(data.total);
  });

  it("someone else's run reads as not found", async () => {
    const bobRuns = await history(bob.session);
    const bobRun = (bobRuns.data.generations as { id: string }[])[0].id;

    expect((await api(`/api/generations/${bobRun}`, { session: alice.session })).status).toBe(404);
    expect((await api(`/api/generations/${bobRun}`, { session: bob.session })).status).toBe(200);
    expect((await api(`/api/generations/${bobRun}`, { session: root })).status).toBe(200);
  });

  it("filters by status and prompt (regex-safe)", async () => {
    expect((await history(alice.session, "status=failed")).data.total).toBe(1);
    expect((await history(alice.session, "status=succeeded")).data.total).toBe(3);
    expect((await history(alice.session, "q=BLUE")).data.total).toBe(1);
    expect((await history(alice.session, "q=.*")).data.total).toBe(0);
    expect((await history(alice.session, "q=(((((((((((a")).status).toBe(200);
  });

  it("survives hostile paging values", async () => {
    for (const query of [
      "page=Infinity",
      "page=1e308",
      "page=-5",
      "page=abc",
      "page=2.5",
      "pageSize=0",
      "pageSize=-1",
      "pageSize=Infinity",
      "pageSize=100000",
      "status=nonsense",
    ]) {
      const { status, data } = await history(alice.session, query);
      expect(status, query).toBe(200);
      expect(data.pageSize as number, query).toBeLessThanOrEqual(60);
    }
  });

  it("pages never overlap", async () => {
    const first = await history(alice.session, "pageSize=2&page=1");
    const second = await history(alice.session, "pageSize=2&page=2");
    const ids = [...(first.data.generations as { id: string }[]), ...(second.data.generations as { id: string }[])].map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
  });
});

describe("expenses", () => {
  const period = () => {
    const start = new Date(Date.now() - 24 * 3600_000).toISOString();
    return `todayStart=${start}&weekStart=${start}&monthStart=${start}`;
  };

  it("are scoped per user and add up", async () => {
    const mine = await api(`/api/expenses?${period()}`, { session: alice.session });
    expect(mine.status).toBe(200);

    const totals = mine.data.totals as { allTime: { amountUsd: number; count: number } };
    expect(totals.allTime.count).toBe(3);
    expect(totals.allTime.amountUsd).toBeCloseTo(0.117);
    expect(mine.data.byUser).toEqual([]);
  });

  it("show a project's current name after a rename", async () => {
    const renamed = `${project.name} (renamed)`;
    await api(`/api/projects/${project.id}`, { method: "PATCH", session: root, json: { name: renamed } });

    const report = await api(`/api/expenses?${period()}`, { session: root });
    const group = (report.data.byProject as { id: string; name: string }[]).find(
      (item) => item.id === project.id
    );
    expect(group?.name).toBe(renamed);

    const runs = await api("/api/generations", { session: alice.session });
    expect((runs.data.generations as { project: string }[])[0].project).toBe(renamed);

    project.name = renamed;
  });

  it("tolerates garbage period values", async () => {
    const { status } = await api("/api/expenses?todayStart=nope&weekStart=&monthStart=1e400", {
      session: alice.session,
    });
    expect(status).toBe(200);
  });
});

describe("download proxy", () => {
  it("only fetches Replicate output files", async () => {
    for (const url of [
      "https://api.replicate.com/v1/predictions/someone-elses-id",
      "http://replicate.delivery/x.png",
      "https://replicate.delivery.evil.com/x.png",
      "https://evil.com/x.png",
      "http://127.0.0.1:27017/",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      const { status } = await api(`/api/download?url=${encodeURIComponent(url)}`, {
        session: alice.session,
      });
      expect(status, url).toBe(400);
    }
  });
});

describe("uploads", () => {
  const upload = (file: Blob, name: string, session: Session = alice.session) => {
    const body = new FormData();
    body.append("file", file, name);
    return api("/api/upload", { session, body, method: "POST" });
  };

  it("accepts media and returns a URL", async () => {
    const { status, data } = await upload(new Blob([PNG], { type: "image/png" }), "a.png");
    expect(status).toBe(200);
    expect(data.url).toMatch(/^https:\/\/replicate\.delivery\//);
  });

  it("accepts large images in full (past the proxy's 10 MB default)", async () => {
    const big = new Uint8Array(30 * 1024 * 1024);
    big.set(PNG);

    const { status, data } = await upload(new Blob([big], { type: "image/png" }), "big.png");
    expect(status, JSON.stringify(data)).toBe(200);

    const sent = (await replicateRequests()).filter((r) => r.path === "/v1/files").at(-1);
    expect(sent?.bytes).toBeGreaterThan(big.length);
  });

  it("refuses other file types and empty uploads", async () => {
    expect((await upload(new Blob(["<html>"], { type: "text/html" }), "a.html")).status).toBe(415);
    expect((await upload(new Blob([], { type: "image/png" }), "empty.png")).status).toBe(400);
  });
});

describe("project photos", () => {
  const putImage = (session: Session, file: Blob, name = "photo") => {
    const body = new FormData();
    body.append("file", file, name);
    return api(`/api/projects/${project.id}/image`, { method: "PUT", session, body });
  };

  it("stores real images and serves them to signed-in users", async () => {
    const put = await putImage(root, new Blob([PNG], { type: "image/png" }));
    expect(put.status).toBe(200);

    const url = put.data.imageUrl as string;
    const image = await api(url, { session: alice.session });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects SVG and disguised files, and plain users", async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
      type: "image/svg+xml",
    });
    expect((await putImage(root, svg, "x.svg")).status).toBe(415);

    const disguised = new Blob(["<html><script>alert(1)</script>"], { type: "image/png" });
    expect((await putImage(root, disguised, "x.png")).status).toBe(415);

    expect((await putImage(alice.session, new Blob([PNG], { type: "image/png" }))).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayloadFromClientToken } from "@vercel/blob/client";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import {
  api,
  closeDb,
  createProject,
  createUser,
  db,
  fakeOutputUrl,
  loginRoot,
  pollPrediction,
  replicateUrl,
  setPrediction,
  startGeneration,
} from "./helpers";

// --------------------------------------------------
// Naar Cuts: edit projects private to their owner, with
// every file they use copied into their own Blob folder
// (cuts/<userId>/<cutId>/), outputs and element files
// included.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { name: string };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
});

// Deleting a cut lists its own Blob folder; the cleanup
// test checks only inputs/ and outputs/ are ever listed
afterAll(async () => {
  await fetch(`${replicateUrl}/__control/blobs`, { method: "DELETE" });
  await closeDb();
});

type Session = typeof alice.session;

async function storeBlob(pathname: string, contentType: string) {
  const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": contentType },
    body: new Uint8Array([1, 2, 3, 4]),
  });
  return ((await response.json()) as { url: string }).url;
}

async function newCut(session: Session, name?: string) {
  const { status, data } = await api("/api/cuts", { session, json: name === undefined ? {} : { name } });
  expect(status, JSON.stringify(data)).toBe(201);
  return data.cut as { id: string; name: string; version: number };
}

const addAsset = (session: Session, cutId: string, json: Record<string, unknown>) =>
  api(`/api/cuts/${cutId}/assets`, { session, json });

async function finishedRun() {
  const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: `cut-${Date.now()}` });
  await setPrediction(id, { status: "succeeded", output: [fakeOutputUrl()] });
  await pollPrediction(alice.session, id);
  return id;
}

describe("Naar Cuts projects", () => {
  it("creates, lists, renames and keeps cuts private", async () => {
    const cut = await newCut(alice.session, "Launch film");
    expect(cut).toMatchObject({ name: "Launch film", version: 1 });

    const untitled = await newCut(alice.session);
    expect(untitled.name).toBe("Untitled cut");

    const listed = await api("/api/cuts", { session: alice.session });
    expect(listed.data.storage).toBe(true);
    expect((listed.data.cuts as { id: string }[]).map((item) => item.id)).toEqual(
      expect.arrayContaining([cut.id, untitled.id])
    );

    // Someone else's cut doesn't exist for them
    expect((await api(`/api/cuts/${cut.id}`, { session: bob.session })).status).toBe(404);
    expect((await api("/api/cuts", { session: bob.session })).data.cuts).toEqual([]);
    expect((await api("/api/cuts")).status).toBe(401);
    expect((await api("/api/cuts", { session: alice.session, json: { name: "x".repeat(81) } })).status).toBe(400);
  });

  it("saves the timeline, and refuses a save based on an old version", async () => {
    const cut = await newCut(alice.session);
    const timeline = { fps: 30, tracks: [], clips: [] };

    const saved = await api(`/api/cuts/${cut.id}`, {
      method: "PATCH",
      session: alice.session,
      json: { version: 1, timeline, durationMs: 4200, name: "Renamed" },
    });
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    expect(saved.data.cut).toMatchObject({ version: 2, timeline, durationMs: 4200, name: "Renamed" });

    // Another tab still on version 1
    const stale = await api(`/api/cuts/${cut.id}`, {
      method: "PATCH",
      session: alice.session,
      json: { version: 1, timeline: { fps: 24, tracks: [], clips: [] } },
    });
    expect(stale.status).toBe(409);
    expect((await api(`/api/cuts/${cut.id}`, { session: alice.session })).data.cut).toMatchObject({ timeline, version: 2 });

    const bobSave = await api(`/api/cuts/${cut.id}`, { method: "PATCH", session: bob.session, json: { version: 2, name: "x" } });
    expect(bobSave.status).toBe(404);
    expect((await api(`/api/cuts/${cut.id}`, { method: "PATCH", session: alice.session, json: { timeline } })).status).toBe(400);
    expect(
      (await api(`/api/cuts/${cut.id}`, { method: "PATCH", session: alice.session, json: { version: 2, timeline: [] } })).status
    ).toBe(400);
  });
});

describe("Naar Cuts files", () => {
  it("copies a run's output into the cut's own folder, once", async () => {
    const cut = await newCut(alice.session);
    const runId = await finishedRun();

    const added = await addAsset(alice.session, cut.id, { source: "generation", id: runId });
    expect(added.status, JSON.stringify(added.data)).toBe(201);
    const asset = added.data.asset as { id: string; url: string; kind: string; source: string; sourceRef: string; size: number };
    expect(asset.url).toMatch(new RegExp(`/cuts/${alice.id}/${cut.id}/media/run-[^/]+\\.png$`));
    expect(asset).toMatchObject({ kind: "image", source: "generation", sourceRef: runId });
    expect(asset.size).toBeGreaterThan(0);

    // A real copy, readable by the browser
    const copy = await fetch(asset.url);
    expect(copy.status).toBe(200);
    expect(copy.headers.get("access-control-allow-origin")).toBe("*");

    const again = await addAsset(alice.session, cut.id, { source: "generation", id: runId });
    expect((again.data.asset as { id: string }).id).toBe(asset.id);
    expect(await (await db()).collection("cutAssets").countDocuments({ cutId: cut.id })).toBe(1);

    // Not someone else's run, nor into someone else's cut
    const bobCut = await newCut(bob.session);
    expect((await addAsset(bob.session, bobCut.id, { source: "generation", id: runId })).status).toBe(404);
    expect((await addAsset(bob.session, cut.id, { source: "generation", id: runId })).status).toBe(404);

    const files = await api(`/api/cuts/${cut.id}/assets`, { session: alice.session });
    expect((files.data.assets as { id: string }[]).map((item) => item.id)).toEqual([asset.id]);
  });

  it("copies an element's file, but only from the user's own elements", async () => {
    const cut = await newCut(alice.session);
    const imageUrl = await storeBlob(`library/${alice.id}/hero.png`, "image/png");
    await api("/api/library", { session: alice.session, json: { url: imageUrl, name: "hero.png" } });
    const element = await api("/api/elements", {
      session: alice.session,
      json: { name: `hero_${Date.now() % 100000}`, images: [imageUrl] },
    });
    expect(element.status, JSON.stringify(element.data)).toBe(201);

    const added = await addAsset(alice.session, cut.id, { source: "element", url: imageUrl });
    expect(added.status, JSON.stringify(added.data)).toBe(201);
    expect(added.data.asset).toMatchObject({ kind: "image", source: "element", sourceRef: imageUrl });
    expect((added.data.asset as { url: string }).url).toContain(`/cuts/${alice.id}/${cut.id}/media/`);

    // Bob can't pull Alice's element file into his cut
    const bobCut = await newCut(bob.session);
    expect((await addAsset(bob.session, bobCut.id, { source: "element", url: imageUrl })).status).toBe(404);
    expect((await addAsset(alice.session, cut.id, { source: "element", url: "https://example.com/x.png" })).status).toBe(404);
  });

  it("registers uploads only from the cut's own folder", async () => {
    const cut = await newCut(alice.session);

    const token = (session: Session, pathname: string) =>
      api("/api/cuts/upload", {
        session,
        json: { type: "blob.generate-client-token", payload: { pathname, multipart: true, clientPayload: null } },
      });

    const ok = await token(alice.session, `cuts/${alice.id}/${cut.id}/media/clip.mp4`);
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(getPayloadFromClientToken(ok.data.clientToken as string)).toMatchObject({
      allowedContentTypes: ["image/*", "video/*", "audio/*"],
    });
    const exporting = await token(alice.session, `cuts/${alice.id}/${cut.id}/exports/final.mp4`);
    expect(getPayloadFromClientToken(exporting.data.clientToken as string)).toMatchObject({ allowedContentTypes: ["video/*"] });

    expect((await token(bob.session, `cuts/${alice.id}/${cut.id}/media/clip.mp4`)).status).toBe(400);
    expect((await token(alice.session, `cuts/${alice.id}/not-a-cut/media/clip.mp4`)).status).toBe(400);
    expect((await token(alice.session, `cuts/${alice.id}/${cut.id}/clip.mp4`)).status).toBe(400);
    expect((await token(alice.session, `library/${alice.id}/clip.mp4`)).status).toBe(400);

    const uploaded = await storeBlob(`cuts/${alice.id}/${cut.id}/media/voice.mp3`, "audio/mpeg");
    const registered = await addAsset(alice.session, cut.id, { source: "upload", url: uploaded, name: "voice.mp3" });
    expect(registered.status, JSON.stringify(registered.data)).toBe(201);
    expect(registered.data.asset).toMatchObject({ kind: "audio", source: "upload", size: 4, name: "voice.mp3" });

    const rendered = await storeBlob(`cuts/${alice.id}/${cut.id}/exports/final.mp4`, "video/mp4");
    expect((await addAsset(alice.session, cut.id, { source: "export", url: rendered })).data.asset).toMatchObject({
      kind: "export",
    });

    // Someone else's file, or one outside the folder
    const elsewhere = await storeBlob(`library/${alice.id}/other.mp3`, "audio/mpeg");
    expect((await addAsset(alice.session, cut.id, { source: "upload", url: elsewhere })).status).toBe(400);
    expect((await addAsset(alice.session, cut.id, { source: "export", url: uploaded })).status).toBe(400);
  });

  it("saves measured details, and removes a file", async () => {
    const cut = await newCut(alice.session);
    const uploaded = await storeBlob(`cuts/${alice.id}/${cut.id}/media/shot.mp4`, "video/mp4");
    const asset = (await addAsset(alice.session, cut.id, { source: "upload", url: uploaded })).data.asset as { id: string; url: string };
    const path = `/api/cuts/${cut.id}/assets/${asset.id}`;

    const measured = await api(path, {
      method: "PATCH",
      session: alice.session,
      json: { durationMs: 5000, width: 1920, height: 1080, peaks: [0, 128, 255] },
    });
    expect(measured.data.asset).toMatchObject({ durationMs: 5000, width: 1920, height: 1080, peaks: [0, 128, 255] });
    expect((await api(path, { method: "PATCH", session: alice.session, json: { peaks: [300] } })).status).toBe(400);

    // As the cut's poster, then removed: the poster goes too
    const poster = await api(`/api/cuts/${cut.id}`, {
      method: "PATCH",
      session: alice.session,
      json: { version: 1, posterUrl: asset.url },
    });
    expect(poster.data.cut).toMatchObject({ posterUrl: asset.url });

    expect((await api(path, { method: "DELETE", session: bob.session })).status).toBe(404);
    expect((await api(path, { method: "DELETE", session: alice.session })).status).toBe(200);
    expect((await fetch(asset.url)).status).toBe(404);
    expect((await api(`/api/cuts/${cut.id}`, { session: alice.session })).data.cut).toMatchObject({ posterUrl: null });
  });

  it("deleting a cut removes its records and every file in its folder", async () => {
    const cut = await newCut(alice.session);
    const runId = await finishedRun();
    const copy = (await addAsset(alice.session, cut.id, { source: "generation", id: runId })).data.asset as { url: string };
    const stray = await storeBlob(`cuts/${alice.id}/${cut.id}/exports/half.mp4`, "video/mp4");

    expect((await api(`/api/cuts/${cut.id}`, { method: "DELETE", session: bob.session })).status).toBe(404);
    expect((await api(`/api/cuts/${cut.id}`, { method: "DELETE", session: alice.session })).status).toBe(200);

    expect((await fetch(copy.url)).status).toBe(404);
    expect((await fetch(stray)).status).toBe(404);
    expect(await (await db()).collection("cutAssets").countDocuments({ cutId: cut.id })).toBe(0);
    expect((await api(`/api/cuts/${cut.id}`, { session: alice.session })).status).toBe(404);

    // The run's own output is untouched
    const run = await api(`/api/generations/${runId}/output`, { session: alice.session });
    expect(run.status).toBe(200);
  });
});

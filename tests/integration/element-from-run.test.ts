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
  replicateUrl,
  setPrediction,
  startGeneration,
} from "./helpers";

// --------------------------------------------------
// A run's output into the library: its saved copy is
// copied into the user's folder (once), to reuse as an
// input; images can then go into an element.
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

afterAll(closeDb);

const save = (session: typeof alice.session | null, generationId: unknown) =>
  api("/api/library/from-generation", { session, json: { generationId } });

async function finishedRun(output = fakeOutputUrl()) {
  const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: `run-${Date.now()}` });
  await setPrediction(id, { status: "succeeded", output: [output] });
  await pollPrediction(alice.session, id);
  return id;
}

describe("adding a run's image to an element", () => {
  it("copies the image into the library once, ready for an element", async () => {
    const id = await finishedRun();

    const first = await save(alice.session, id);
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    const file = first.data.file as { url: string; kind: string; contentType: string };
    expect(file.url).toMatch(new RegExp(`/library/${alice.id}/run-[^/]+\\.png$`));
    expect(file).toMatchObject({ kind: "image", contentType: "image/png" });

    // The copy holds the image itself
    const stored = await fetch(file.url);
    expect(stored.status).toBe(200);
    expect((await stored.arrayBuffer()).byteLength).toBeGreaterThan(0);

    // Again: the same library file, not a second copy
    const again = await save(alice.session, id);
    expect((again.data.file as { url: string }).url).toBe(file.url);
    expect(await (await db()).collection("libraryFiles").countDocuments({ fromGenerationId: id })).toBe(1);

    // Listed in the library, and usable in an element
    const library = await api("/api/library?kind=image", { session: alice.session });
    expect((library.data.files as { url: string }[]).map((item) => item.url)).toContain(file.url);
    const element = await api("/api/elements", {
      session: alice.session,
      json: { name: `from_run_${Date.now() % 100000}`, images: [file.url] },
    });
    expect(element.status, JSON.stringify(element.data)).toBe(201);
  });

  it("saves videos to the library too, but never into an element", async () => {
    const id = await finishedRun(`${replicateUrl}/__control/output.mp4`);
    const saved = await save(alice.session, id);
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
    const file = saved.data.file as { url: string; kind: string };
    expect(file).toMatchObject({ kind: "video", contentType: "video/mp4" });
    expect(file.url).toMatch(/\/run-[^/]+\.mp4$/);

    const videos = await api("/api/library?kind=video", { session: alice.session });
    expect((videos.data.files as { url: string }[]).map((item) => item.url)).toContain(file.url);

    const element = await api("/api/elements", {
      session: alice.session,
      json: { name: `video_${Date.now() % 100000}`, images: [file.url] },
    });
    expect(element.status).toBe(400);
  });

  it("lists past outputs of one kind to pick from", async () => {
    const image = await finishedRun();
    const video = await finishedRun(`${replicateUrl}/__control/output.mp4`);
    const running = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: "not yet" });

    const ids = async (query: string, session = alice.session) =>
      ((await api(`/api/generations?options=0&pageSize=60&${query}`, { session })).data.generations as { id: string }[]).map(
        (item) => item.id
      );

    const images = await ids("kind=image");
    expect(images).toContain(image);
    expect(images).not.toContain(video);
    expect(images).not.toContain(running);
    expect(await ids("kind=video")).toContain(video);
    expect(await ids("kind=video")).not.toContain(image);
    // Only the viewer's own
    expect(await ids("kind=image", bob.session)).not.toContain(image);
  });

  it("refuses other people's runs, unfinished runs and strangers", async () => {
    const id = await finishedRun();
    expect((await save(bob.session, id)).status).toBe(404);
    expect((await save(alice.session, "no-such-run")).status).toBe(404);
    expect((await save(alice.session, "")).status).toBe(400);
    expect((await save(null, id)).status).toBe(401);


    const running = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: "still going" });
    expect((await save(alice.session, running)).status).toBe(409);
  });
});

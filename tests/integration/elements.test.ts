import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, closeDb, createUser, loginRoot, replicateUrl } from "./helpers";

// --------------------------------------------------
// Elements: named reference images, videos and voice
// clips (from the user's own media library), private to
// each user.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
});

afterAll(closeDb);

// A file in the user's library, as after an upload
async function libraryImage(user: typeof alice, name: string, contentType = "image/png") {
  const response = await fetch(
    `${replicateUrl}/blob/?pathname=${encodeURIComponent(`library/${user.id}/${name}`)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": contentType },
      body: new Uint8Array([1, 2, 3]),
    }
  );
  const { url } = (await response.json()) as { url: string };
  const saved = await api("/api/library", { session: user.session, json: { url, name } });
  expect(saved.status).toBe(200);
  return url;
}

describe("elements", () => {
  it("creates, lists, edits and deletes an element", async () => {
    const front = await libraryImage(alice, "front.png");
    const side = await libraryImage(alice, "side.png");

    const created = await api("/api/elements", {
      session: alice.session,
      json: { name: "@Maya", description: " a woman with red hair ", images: [front, side, front] },
    });
    expect(created.status).toBe(201);
    const element = created.data.element as { id: string };
    expect(created.data.element).toMatchObject({ name: "Maya", description: "a woman with red hair", images: [front, side] });

    expect((await api("/api/elements", { session: alice.session })).data.elements).toEqual([created.data.element]);
    // Private
    expect((await api("/api/elements", { session: bob.session })).data.elements).toEqual([]);
    expect(
      (await api(`/api/elements/${element.id}`, { session: bob.session, method: "PATCH", json: { name: "x" } })).status
    ).toBe(404);

    const edited = await api(`/api/elements/${element.id}`, {
      session: alice.session,
      method: "PATCH",
      json: { description: "", images: [side] },
    });
    expect(edited.data.element).toMatchObject({ name: "Maya", description: "", images: [side] });

    expect((await api(`/api/elements/${element.id}`, { session: bob.session, method: "DELETE" })).status).toBe(404);
    expect((await api(`/api/elements/${element.id}`, { session: alice.session, method: "DELETE" })).status).toBe(200);
    expect((await api("/api/elements", { session: alice.session })).data.elements).toEqual([]);
  });

  it("checks names, descriptions and images", async () => {
    const image = await libraryImage(alice, "a.png");
    const video = await libraryImage(alice, "clip.mp4", "video/mp4");
    const bobs = await libraryImage(bob, "b.png");

    const create = (json: Record<string, unknown>) =>
      api("/api/elements", { session: alice.session, json: { name: "ok", images: [image], ...json } });

    expect((await create({ name: "two words" })).status).toBe(400);
    expect((await create({ name: "" })).status).toBe(400);
    expect((await create({ name: "x".repeat(41) })).status).toBe(400);
    expect((await create({ description: "x".repeat(501) })).status).toBe(400);
    expect((await create({ images: [] })).status).toBe(400);
    expect((await create({ images: Array.from({ length: 8 }, (_, i) => `${image}?${i}`) })).status).toBe(400);
    // Only the user's own library images
    expect((await create({ images: [bobs] })).status).toBe(400);
    expect((await create({ images: [video] })).status).toBe(400);
    expect((await create({ images: ["https://example.com/x.png"] })).status).toBe(400);

    // Names are unique per user, ignoring case
    expect((await create({ name: "Dup" })).status).toBe(201);
    expect((await create({ name: "dup" })).status).toBe(409);
    expect(
      (await api("/api/elements", { session: bob.session, json: { name: "dup", images: [bobs] } })).status
    ).toBe(201);

    expect((await api("/api/elements")).status).toBe(401);
  });

  it("holds reference videos and voice clips too", async () => {
    const image = await libraryImage(alice, "face.png");
    const video = await libraryImage(alice, "walk.mp4", "video/mp4");
    const voice = await libraryImage(alice, "voice.mp3", "audio/mpeg");
    const bobsVoice = await libraryImage(bob, "bob.mp3", "audio/mpeg");

    // A voice alone is enough
    const voiceOnly = await api("/api/elements", { session: alice.session, json: { name: "narrator", audios: [voice] } });
    expect(voiceOnly.status, JSON.stringify(voiceOnly.data)).toBe(201);
    expect(voiceOnly.data.element).toMatchObject({ images: [], videos: [], audios: [voice] });

    const all = await api("/api/elements", {
      session: alice.session,
      json: { name: "Rex", images: [image], videos: [video, video], audios: [voice] },
    });
    expect(all.status).toBe(201);
    const rex = all.data.element as { id: string };
    expect(all.data.element).toMatchObject({ images: [image], videos: [video], audios: [voice] });

    const patch = (json: Record<string, unknown>) =>
      api(`/api/elements/${rex.id}`, { session: alice.session, method: "PATCH", json });

    // Each list is checked on its own kind and limit
    expect((await patch({ videos: [voice] })).status).toBe(400);
    expect((await patch({ audios: [video] })).status).toBe(400);
    expect((await patch({ audios: [bobsVoice] })).status).toBe(400);
    expect((await patch({ videos: Array.from({ length: 4 }, (_, i) => `${video}?${i}`) })).status).toBe(400);

    // Emptying one list is fine while others have files...
    expect((await patch({ images: [], videos: [] })).data.element).toMatchObject({ images: [], videos: [], audios: [voice] });
    // ...but not the last file
    const last = await patch({ audios: [] });
    expect(last.status).toBe(400);
    expect(last.data.error).toMatch(/at least one/);

    // Nothing at all on create
    expect((await api("/api/elements", { session: alice.session, json: { name: "empty" } })).status).toBe(400);
  });
});

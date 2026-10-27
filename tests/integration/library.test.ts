import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayloadFromClientToken } from "@vercel/blob/client";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, closeDb, createUser, loginRoot, replicateUrl } from "./helpers";

// --------------------------------------------------
// The media library: uploads kept per user in Blob
// (library/<userId>/), listed for reuse, never swept by
// the 7-day cleanup.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
});

afterAll(closeDb);

// Stores a file in the fake Blob as the browser would
async function storeBlob(pathname: string, contentType: string) {
  const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": contentType },
    body: new Uint8Array([1, 2, 3, 4]),
  });
  return ((await response.json()) as { url: string }).url;
}

const requestToken = (session: typeof alice.session | null, pathname: string) =>
  api("/api/library/upload", {
    session,
    json: {
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: null },
    },
  });

describe("media library", () => {
  it("tells each user their own folder", async () => {
    const { status, data } = await api("/api/library", { session: alice.session });
    expect(status).toBe(200);
    expect(data).toEqual({ enabled: true, folder: `library/${alice.id}/`, files: [] });

    expect((await api("/api/library")).status).toBe(401);
  });

  it("hands out upload tokens only for the user's own folder", async () => {
    const { status, data } = await requestToken(alice.session, `library/${alice.id}/cat.png`);
    expect(status).toBe(200);
    expect(getPayloadFromClientToken(data.clientToken as string)).toMatchObject({
      pathname: `library/${alice.id}/cat.png`,
      maximumSizeInBytes: 100 * 1024 * 1024,
      allowedContentTypes: ["image/*", "video/*", "audio/*"],
    });

    expect((await requestToken(alice.session, `library/${bob.id}/cat.png`)).status).toBe(400);
    expect((await requestToken(alice.session, `library/${alice.id}/../x.png`)).status).toBe(400);
    expect((await requestToken(alice.session, "inputs/cat.png")).status).toBe(400);
    expect((await requestToken(null, `library/${alice.id}/cat.png`)).status).toBe(401);
  });

  it("saves, lists, and deletes a user's files", async () => {
    const imageUrl = await storeBlob(`library/${alice.id}/cat.png`, "image/png");
    const videoUrl = await storeBlob(`library/${alice.id}/clip.mp4`, "video/mp4");

    const saved = await api("/api/library", {
      session: alice.session,
      json: { url: imageUrl, name: "cat.png" },
    });
    expect(saved.status).toBe(200);
    expect(saved.data.file).toMatchObject({ url: imageUrl, name: "cat.png", kind: "image", contentType: "image/png", size: 4 });

    // Saving the same file again doesn't duplicate it
    const again = await api("/api/library", { session: alice.session, json: { url: imageUrl, name: "cat.png" } });
    expect((again.data.file as { id: string }).id).toBe((saved.data.file as { id: string }).id);

    await api("/api/library", { session: alice.session, json: { url: videoUrl, name: "clip.mp4" } });

    // Listed by kind
    const images = await api("/api/library?kind=image", { session: alice.session });
    expect((images.data.files as { url: string }[]).map((file) => file.url)).toEqual([imageUrl]);
    const videos = await api("/api/library?kind=video", { session: alice.session });
    expect((videos.data.files as { url: string }[]).map((file) => file.url)).toEqual([videoUrl]);

    // Private to its owner
    expect((await api("/api/library?kind=image", { session: bob.session })).data.files).toEqual([]);
    const id = (saved.data.file as { id: string }).id;
    expect((await api(`/api/library/${id}`, { session: bob.session, method: "DELETE" })).status).toBe(404);

    // Deleting removes the entry and the file
    expect((await api(`/api/library/${id}`, { session: alice.session, method: "DELETE" })).status).toBe(200);
    expect((await api("/api/library?kind=image", { session: alice.session })).data.files).toEqual([]);
    expect((await fetch(imageUrl)).status).toBe(404);
  });

  it("refuses files outside the user's folder, unknown files and non-media", async () => {
    const bobs = await storeBlob(`library/${bob.id}/secret.png`, "image/png");
    const input = await storeBlob("inputs/photo.png", "image/png");
    const text = await storeBlob(`library/${alice.id}/notes.txt`, "text/plain");

    const add = (url: string) => api("/api/library", { session: alice.session, json: { url, name: "x" } });

    expect((await add(bobs)).status).toBe(403);
    expect((await add(input)).status).toBe(403);
    expect((await add(text)).status).toBe(415);
    expect((await add(`${replicateUrl}/blobfiles/library/${alice.id}/missing.png`)).status).toBe(404);
    expect((await api("/api/library", { session: alice.session, json: {} })).status).toBe(400);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, closeDb, createUser, loginRoot, replicateUrl, type Session } from "./helpers";

// --------------------------------------------------
// The super admin sees every user's library files and
// elements (?scope=all), each with who added it, and can
// delete them (not edit). Nobody else can, and the usual
// lists stay each user's own.
// --------------------------------------------------

let root: Session;
let alice: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user", { name: "Alice Smith" });
  admin = await createUser(root, "admin");
});

afterAll(closeDb);

async function libraryImage(session: Session, userId: string, name: string) {
  const response = await fetch(
    `${replicateUrl}/blob/?pathname=${encodeURIComponent(`library/${userId}/${name}`)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    }
  );
  const { url } = (await response.json()) as { url: string };
  const saved = await api("/api/library", { session, json: { url, name } });
  expect(saved.status).toBe(200);
  return url;
}

type Owned = { name: string; addedBy?: { id: string; name: string } };

describe("everyone's library and elements", () => {
  it("lists them for the super admin with who added each", async () => {
    const url = await libraryImage(alice.session, alice.id, "alice-face.png");
    const created = await api("/api/elements", { session: alice.session, json: { name: "AliceHero", images: [url] } });
    expect(created.status).toBe(201);

    const files = (await api("/api/library?kind=image&scope=all", { session: root })).data.files as (Owned & { url: string })[];
    expect(files.find((file) => file.url === url)?.addedBy).toEqual({ id: alice.id, name: "Alice Smith" });

    const elements = (await api("/api/elements?scope=all", { session: root })).data.elements as Owned[];
    expect(elements.find((element) => element.name === "AliceHero")?.addedBy).toEqual({ id: alice.id, name: "Alice Smith" });
  });

  it("keeps the usual lists to the user's own", async () => {
    const files = (await api("/api/library?kind=image", { session: root })).data.files as Owned[];
    expect(files.some((file) => file.name === "alice-face.png")).toBe(false);

    const elements = (await api("/api/elements", { session: root })).data.elements as Owned[];
    expect(elements.some((element) => element.name === "AliceHero")).toBe(false);
  });

  it("refuses everyone else, admins included", async () => {
    for (const session of [alice.session, admin.session]) {
      expect((await api("/api/library?kind=image&scope=all", { session })).status).toBe(403);
      expect((await api("/api/elements?scope=all", { session })).status).toBe(403);
    }
  });

  it("lets only the super admin delete another user's element and file", async () => {
    const elements = (await api("/api/elements?scope=all", { session: root })).data.elements as (Owned & { id: string })[];
    const element = elements.find((item) => item.name === "AliceHero")!;
    const files = (await api("/api/library?kind=image&scope=all", { session: root })).data.files as (Owned & { id: string })[];
    const file = files.find((item) => item.name === "alice-face.png")!;

    // Not an admin, not editing
    expect((await api(`/api/elements/${element.id}`, { session: admin.session, method: "DELETE" })).status).toBe(404);
    expect((await api(`/api/library/${file.id}`, { session: admin.session, method: "DELETE" })).status).toBe(404);
    expect(
      (await api(`/api/elements/${element.id}`, { session: root, method: "PATCH", json: { description: "x" } })).status
    ).toBe(404);

    expect((await api(`/api/elements/${element.id}`, { session: root, method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/library/${file.id}`, { session: root, method: "DELETE" })).status).toBe(200);

    // Gone from the owner's lists
    const own = (await api("/api/elements", { session: alice.session })).data.elements as Owned[];
    expect(own.some((item) => item.name === "AliceHero")).toBe(false);
    const ownFiles = (await api("/api/library?kind=image", { session: alice.session })).data.files as Owned[];
    expect(ownFiles.some((item) => item.name === "alice-face.png")).toBe(false);
  });
});

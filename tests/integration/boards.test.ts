import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, closeDb, createUser, db, loginRoot, replicateUrl } from "./helpers";

// --------------------------------------------------
// Naar Boards: boards are their owner's; changes save as
// operations; media is copied into the board's storage.
// --------------------------------------------------

let root: Awaited<ReturnType<typeof loginRoot>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  admin = await createUser(root, "admin");
});

afterAll(closeDb);

// A file in a user's library, as after an upload
async function libraryImage(user: typeof alice, name: string) {
  const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(`library/${user.id}/${name}`)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": "image/png" },
    body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
  const { url } = (await response.json()) as { url: string };
  const saved = await api("/api/library", { session: user.session, json: { url, name } });
  expect(saved.status).toBe(200);
  return url;
}

const sticky = (id: string, text = "Idea") => ({ id, type: "sticky", x: 10, y: 20, w: 200, h: 200, z: 1, data: { text, color: "yellow" } });

async function newBoard(user = alice, name = "Spring campaign") {
  const { status, data } = await api("/api/boards", { session: user.session, json: { name } });
  expect(status).toBe(201);
  return data.board as { id: string; name: string };
}

const save = (id: string, ops: unknown[], user = alice) => api(`/api/boards/${id}/ops`, { session: user.session, json: { ops } });

describe("boards", () => {
  it("creates, lists, renames and keeps boards private to their owner", async () => {
    const board = await newBoard();
    expect(board.name).toBe("Spring campaign");

    const list = await api("/api/boards", { session: alice.session });
    expect((list.data.boards as { id: string }[]).map((item) => item.id)).toContain(board.id);
    expect(((await api("/api/boards", { session: bob.session })).data.boards as { id: string }[]).map((item) => item.id)).not.toContain(board.id);

    const renamed = await api(`/api/boards/${board.id}`, { session: alice.session, method: "PATCH", json: { name: "  Spring   look book " } });
    expect((renamed.data.board as { name: string }).name).toBe("Spring look book");
    expect((await api(`/api/boards/${board.id}`, { session: alice.session, method: "PATCH", json: { name: "" } })).status).toBe(400);

    // Someone else's board reads as not found, for everything
    expect((await api(`/api/boards/${board.id}`, { session: bob.session })).status).toBe(404);
    expect((await save(board.id, [{ kind: "put", item: sticky("x") }], bob)).status).toBe(404);
    expect((await api(`/api/boards/${board.id}`, { session: bob.session, method: "DELETE" })).status).toBe(404);
    expect((await api("/api/boards/not-an-id", { session: alice.session })).status).toBe(404);
    expect((await api("/api/boards")).status).toBe(401);
  });

  it("saves operations in order and loads them back", async () => {
    const board = await newBoard();
    const first = await save(board.id, [
      { kind: "put", item: sticky("a") },
      { kind: "put", item: sticky("b", "Second") },
      { kind: "put", item: { id: "l", type: "connector", x: 0, y: 0, w: 0, h: 0, z: 2, data: { from: { id: "a" }, to: { id: "b" }, label: "" } } },
    ]);
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ applied: 3 });

    const second = await save(board.id, [
      { kind: "patch", id: "a", set: { x: 400, data: { color: "pink" } } },
      { kind: "delete", id: "b" },
    ]);
    expect(second.data.rev).toBeGreaterThan(first.data.rev as number);

    const loaded = await api(`/api/boards/${board.id}`, { session: alice.session });
    const items = loaded.data.items as { id: string; x: number; data: { color?: string; text?: string } }[];
    expect(items.map((item) => item.id).sort()).toEqual(["a", "l"]);
    expect(items.find((item) => item.id === "a")).toMatchObject({ x: 400, data: { color: "pink", text: "Idea" } });

    const listed = (await api("/api/boards", { session: alice.session })).data.boards as { id: string; itemCount: number }[];
    expect(listed.find((item) => item.id === board.id)?.itemCount).toBe(2);
  });

  it("refuses bad operations, whole", async () => {
    const board = await newBoard();
    expect((await save(board.id, [])).status).toBe(400);
    expect((await save(board.id, [{ kind: "put", item: { ...sticky("ok") } }, { kind: "explode" }])).status).toBe(400);
    expect((await save(board.id, Array.from({ length: 501 }, (_, index) => ({ kind: "delete", id: `x${index}` })))).status).toBe(413);
    // Nothing from the refused batches was kept
    expect(((await api(`/api/boards/${board.id}`, { session: alice.session })).data.items as unknown[]).length).toBe(0);
  });

  it("copies media into the board's own storage, and only the user's own files", async () => {
    const board = await newBoard();
    const mine = await libraryImage(alice, "look.png");
    const bobs = await libraryImage(bob, "secret.png");

    const added = await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: mine } });
    expect(added.status).toBe(200);
    const asset = added.data.asset as { url: string; contentType: string };
    expect(asset.url).toContain(`/boards/${board.id}/`);
    expect(asset.contentType).toBe("image/png");

    // The same file twice: the same copy
    const again = await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: mine } });
    expect((again.data.asset as { url: string }).url).toBe(asset.url);

    // Someone else's file, or a made-up URL: refused
    expect((await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: bobs } })).status).toBe(403);
    expect((await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: "https://example.com/x.png" } })).status).toBe(403);

    // Items may only show the board's own copies
    const image = { id: "img", type: "image", x: 0, y: 0, w: 400, h: 300, z: 1, data: { url: asset.url, name: "look.png", contentType: "image/png" } };
    expect((await save(board.id, [{ kind: "put", item: image }])).status).toBe(200);
    expect((await save(board.id, [{ kind: "put", item: { ...image, id: "img2", data: { ...image.data, url: mine } } }])).status).toBe(400);

    // The first picture becomes the board's cover
    const listed = (await api("/api/boards", { session: alice.session })).data.boards as { id: string; coverUrl: string | null }[];
    expect(listed.find((item) => item.id === board.id)?.coverUrl).toBe(asset.url);
  });

  it("duplicates a board, and deleting the original keeps the copy's pictures", async () => {
    const board = await newBoard(alice, "Original");
    const file = await libraryImage(alice, "keep.png");
    const asset = (await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: file } })).data.asset as { url: string };
    await save(board.id, [
      { kind: "put", item: sticky("n") },
      { kind: "put", item: { id: "img", type: "image", x: 0, y: 0, w: 400, h: 300, z: 1, data: { url: asset.url, name: "keep.png", contentType: "image/png" } } },
    ]);

    const copy = await api(`/api/boards/${board.id}/duplicate`, { session: alice.session, method: "POST" });
    expect(copy.status).toBe(201);
    const copyId = (copy.data.board as { id: string; name: string }).id;
    expect((copy.data.board as { name: string }).name).toBe("Original copy");
    expect(((await api(`/api/boards/${copyId}`, { session: alice.session })).data.items as unknown[]).length).toBe(2);

    expect((await api(`/api/boards/${board.id}`, { session: alice.session, method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/boards/${board.id}`, { session: alice.session })).status).toBe(404);
    expect(await (await db()).collection("boardItems").countDocuments({ boardId: board.id })).toBe(0);

    // The copy's picture is still there
    expect((await fetch(asset.url)).status).toBe(200);

    // Deleting the copy too removes the file
    expect((await api(`/api/boards/${copyId}`, { session: alice.session, method: "DELETE" })).status).toBe(200);
    expect((await fetch(asset.url)).status).toBe(404);
  });

  it("the super admin sees everyone's boards, view only; nobody else does", async () => {
    const board = await newBoard(alice, "Alice private");
    await save(board.id, [{ kind: "put", item: sticky("s", "Secret plan") }]);

    // Everyone's, with whose
    const all = await api("/api/boards?scope=all", { session: root });
    const row = (all.data.boards as { id: string; ownerName: string }[]).find((item) => item.id === board.id);
    expect(row?.ownerName).toBe(alice.username);

    // Opens it, marked view only
    const opened = await api(`/api/boards/${board.id}`, { session: root });
    expect(opened.status).toBe(200);
    expect(opened.data.readOnly).toBe(true);
    expect((opened.data.items as { data: { text: string } }[])[0].data.text).toBe("Secret plan");
    expect((await api(`/api/boards/${board.id}`, { session: alice.session })).data.readOnly).toBe(false);

    // …and can't change it in any way
    expect((await api(`/api/boards/${board.id}/ops`, { session: root, json: { ops: [{ kind: "delete", id: "s" }] } })).status).toBe(404);
    expect((await api(`/api/boards/${board.id}`, { session: root, method: "PATCH", json: { name: "Mine now" } })).status).toBe(404);
    expect((await api(`/api/boards/${board.id}/duplicate`, { session: root, method: "POST" })).status).toBe(404);
    expect((await api(`/api/boards/${board.id}`, { session: root, method: "DELETE" })).status).toBe(404);
    expect(((await api(`/api/boards/${board.id}`, { session: alice.session })).data.items as unknown[]).length).toBe(1);

    // An admin, or a user asking for everyone's: only their own
    for (const session of [admin.session, bob.session]) {
      const listed = (await api("/api/boards?scope=all", { session })).data.boards as { id: string }[];
      expect(listed.map((item) => item.id)).not.toContain(board.id);
      expect((await api(`/api/boards/${board.id}`, { session })).status).toBe(404);
    }
  });

  it("downloads a picture pasted from another website, and refuses anything else", async () => {
    const board = await newBoard(alice, "From the web");
    const remote = `${replicateUrl}/__control/output.png`;
    const added = await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { remoteUrl: remote } });
    expect(added.status).toBe(200);
    const asset = added.data.asset as { url: string; contentType: string };
    expect(asset.url).toContain(`/boards/${board.id}/`);
    expect(asset.contentType).toBe("image/png");
    // Same address twice: one copy
    expect(((await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { remoteUrl: remote } })).data.asset as { url: string }).url).toBe(asset.url);
    // It can be placed like any picture
    const image = { id: "web", type: "image", x: 0, y: 0, w: 300, h: 300, z: 1, data: { url: asset.url, name: "output.png", contentType: "image/png" } };
    expect((await save(board.id, [{ kind: "put", item: image }])).status).toBe(200);

    // Not a picture, internal addresses, other schemes, not an address
    const refuse = async (remoteUrl: string) => (await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { remoteUrl } })).status;
    expect(await refuse(`${replicateUrl}/__control/predictions/nothing`)).toBe(422);
    expect(await refuse("http://127.0.0.1:1/secret.png")).toBe(422);
    expect(await refuse("http://169.254.169.254/latest/meta-data")).toBe(422);
    expect(await refuse("http://10.0.0.5/x.png")).toBe(422);
    expect(await refuse("file:///etc/passwd")).toBe(422);
    expect(await refuse("not a url")).toBe(422);
    // Someone else's board
    expect((await api(`/api/boards/${board.id}/assets`, { session: bob.session, json: { remoteUrl: remote } })).status).toBe(404);
  });

  it("serves the board's own files for download, to who may see the board", async () => {
    const board = await newBoard(alice, "Downloads");
    const source = await libraryImage(alice, "hero.png");
    const asset = (await api(`/api/boards/${board.id}/assets`, { session: alice.session, json: { url: source } })).data.asset as { url: string };
    const file = (download = false) => `/api/boards/${board.id}/file?url=${encodeURIComponent(asset.url)}${download ? "&download=1" : ""}`;

    const own = await api(file(true), { session: alice.session });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect(own.headers.get("content-disposition")).toBe('attachment; filename="hero.png"');
    expect((await api(file(), { session: alice.session })).headers.get("content-disposition")).toBeNull();

    // The super admin (view only) too; nobody else
    expect((await api(file(), { session: root })).status).toBe(200);
    expect((await api(file(), { session: bob.session })).status).toBe(404);
    expect((await api(file())).status).toBe(401);
    // Only this board's files: not a library file, not another address
    expect((await api(`/api/boards/${board.id}/file?url=${encodeURIComponent(source)}`, { session: alice.session })).status).toBe(404);
    expect((await api(`/api/boards/${board.id}/file?url=${encodeURIComponent("http://169.254.169.254/")}`, { session: alice.session })).status).toBe(404);
  });
});

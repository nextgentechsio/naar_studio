import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_FIGMA_FILE_KEY } from "./fake-replicate";
import { api, closeDb, createUser, db, loginRoot } from "./helpers";

// --------------------------------------------------
// Naar Boards: Import from Figma, against a stand-in
// Figma API (never the real one)
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

const link = (key = FAKE_FIGMA_FILE_KEY) => `https://www.figma.com/board/${key}/TMBC-x-IPL-AD?node-id=0-1&p=f`;
const importBoard = (session: typeof alice.session, url: unknown) => api("/api/boards/import-figma", { session, json: { url } });

type Item = { id: string; type: string; x: number; y: number; w: number; h: number; z: number; data: Record<string, unknown> };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
});

afterAll(closeDb);

describe("import from Figma", () => {
  it("makes a new board with everything on the FigJam page", async () => {
    const imported = await importBoard(alice.session, link());
    expect(imported.status).toBe(201);
    expect(imported.data).toMatchObject({ items: 7, pictures: 2, skipped: 0, board: { name: "TMBC x IPL AD", itemCount: 7 } });
    const boardId = (imported.data.board as { id: string }).id;

    const board = await api(`/api/boards/${boardId}`, { session: alice.session });
    expect(board.status).toBe(200);
    const items = board.data.items as Item[];
    const of = (type: string) => items.filter((item) => item.type === type);

    expect(of("frame")).toEqual([expect.objectContaining({ data: { title: "Ideas" }, x: 0, y: 100, w: 900, h: 600 })]);
    expect(of("sticky")).toEqual([expect.objectContaining({ data: { text: "Introduce stats", color: "orange" } })]);
    expect(of("shape")).toEqual([expect.objectContaining({ data: { shape: "ellipse", color: "blue", text: "Decide" } })]);
    expect(of("text")).toEqual([expect.objectContaining({ x: 0, y: 0, data: { text: "How might we improve user profiles?", size: "l" } })]);
    const [connector] = of("connector");
    expect(connector.data).toMatchObject({ from: { id: of("sticky")[0].id }, to: { id: of("shape")[0].id } });

    // The picture and the stamp: copied into the board's
    // own storage, not linked to Figma
    const pictures = of("image");
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) {
      expect(picture.data.url).toMatch(/\/blobfiles\/boards\//);
      expect(picture.data.contentType).toBe("image/png");
    }
    const assets = await (await db()).collection("boardAssets").find({ boardId }).toArray();
    expect(assets.map((asset) => asset.sourceUrl).sort()).toEqual([`figma:${FAKE_FIGMA_FILE_KEY}:image:ref-hero`, `figma:${FAKE_FIGMA_FILE_KEY}:node:2:4`]);

    // The board works like any other: the owner can edit it
    const saved = await api(`/api/boards/${boardId}/ops`, {
      session: alice.session,
      json: { ops: [{ kind: "patch", id: of("sticky")[0].id, set: { x: 500 } }] },
    });
    expect(saved.status).toBe(200);
    expect((await api(`/api/boards/${boardId}`, { session: bob.session })).status).toBe(404);
  });

  it("refuses links that aren't Figma files", async () => {
    for (const url of ["", "https://example.com/board/abc", "https://www.figma.com/files/recents", 7]) {
      const response = await importBoard(alice.session, url);
      expect(response.status, String(url)).toBe(400);
    }
  });

  it("explains when the studio's Figma account can't open the file", async () => {
    const response = await importBoard(alice.session, link("SomeoneElsesFile01"));
    expect(response.status).toBe(403);
    expect(response.data.error).toMatch(/Anyone with the link can view/);
  });

  it("needs a signed-in user", async () => {
    expect((await api("/api/boards/import-figma", { json: { url: link() } })).status).toBe(401);
  });
});

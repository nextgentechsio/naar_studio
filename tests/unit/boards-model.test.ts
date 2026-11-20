import { describe, expect, it } from "vitest";
import {
  applyWithInverse,
  boundsOf,
  cleanItem,
  cleanOp,
  connectorEnds,
  edgePoint,
  itemsInFrame,
  snapRect,
  type BoardItem,
  type BoardOp,
  type ItemMap,
} from "@/lib/boards/shared";

// --------------------------------------------------
// Naar Boards: operations, undo, cleaning and geometry
// --------------------------------------------------

const sticky = (id: string, x = 0, y = 0): BoardItem => ({ id, type: "sticky", x, y, w: 200, h: 200, z: 1, data: { text: "hi", color: "yellow" } });
const map = (...items: BoardItem[]): ItemMap => new Map(items.map((item) => [item.id, item]));

describe("operations", () => {
  it("apply, and their inverse puts everything back", () => {
    const items = map(sticky("a"), sticky("b", 300));
    const before = JSON.stringify([...items]);
    const ops: BoardOp[] = [
      { kind: "put", item: sticky("c", 600) },
      { kind: "patch", id: "a", set: { x: 50, data: { text: "moved", color: "pink" } } },
      { kind: "delete", id: "b" },
    ];
    const inverse = applyWithInverse(items, ops);
    expect(items.get("a")).toMatchObject({ x: 50, data: { text: "moved", color: "pink" } });
    expect(items.has("b")).toBe(false);
    expect(items.has("c")).toBe(true);

    applyWithInverse(items, inverse);
    expect(JSON.stringify([...items].sort())).toBe(JSON.stringify(JSON.parse(before).sort()));
  });

  it("a patch merges data key by key and is re-checked", () => {
    const items = map(sticky("a"));
    applyWithInverse(items, [{ kind: "patch", id: "a", set: { data: { color: "teal" } } }]);
    expect(items.get("a")?.data).toEqual({ text: "hi", color: "teal" });
    // A bad value falls back instead of breaking the item
    applyWithInverse(items, [{ kind: "patch", id: "a", set: { data: { color: "neon" } } }]);
    expect(items.get("a")?.data).toMatchObject({ color: "yellow" });
  });
});

describe("cleaning what the network sends", () => {
  it("keeps good items and refuses bad ones", () => {
    expect(cleanItem(sticky("a"))).toEqual(sticky("a"));
    expect(cleanItem({ ...sticky("a"), id: "../x" })).toBeNull();
    expect(cleanItem({ ...sticky("a"), type: "script" })).toBeNull();
    expect(cleanItem({ ...sticky("a"), x: Number.NaN })).toBeNull();
    expect(cleanItem({ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, z: 0, data: { url: "javascript:alert(1)" } })).toBeNull();
    // Sizes and text are clamped
    const huge = cleanItem({ ...sticky("a"), w: 1e9, data: { text: "x".repeat(10_000), color: "yellow" } });
    expect(huge?.w).toBe(20_000);
    expect((huge?.data as { text: string }).text).toHaveLength(5000);
  });

  it("checks operations", () => {
    expect(cleanOp({ kind: "delete", id: "a" })).toEqual({ kind: "delete", id: "a" });
    expect(cleanOp({ kind: "patch", id: "a", set: { x: 5, evil: 1 } })).toEqual({ kind: "patch", id: "a", set: { x: 5 } });
    expect(cleanOp({ kind: "patch", id: "a", set: {} })).toBeNull();
    expect(cleanOp({ kind: "drop", id: "a" })).toBeNull();
    expect(cleanOp({ kind: "put", item: { id: "a" } })).toBeNull();
  });
});

describe("geometry", () => {
  it("bounds, frame contents and edge points", () => {
    expect(boundsOf([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(boundsOf([])).toBeNull();
    const frame = { id: "f", x: 0, y: 0, w: 500, h: 500 };
    const inside = itemsInFrame(frame, [sticky("in", 10, 10), sticky("out", 400, 400)]);
    expect(inside.map((item) => item.id)).toEqual(["in"]);
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 100 }, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it("connectors end on the edges of the items they join, and follow them", () => {
    const items = map(sticky("a", 0, 0), sticky("b", 500, 0));
    const link: BoardItem = { id: "l", type: "connector", x: 0, y: 0, w: 0, h: 0, z: 2, data: { from: { id: "a" }, to: { id: "b" }, label: "" } };
    expect(connectorEnds(link, items)).toEqual([{ x: 200, y: 100 }, { x: 500, y: 100 }]);
    items.set("b", sticky("b", 500, 300));
    const [, end] = connectorEnds(link, items)!;
    expect(end.y).toBeGreaterThan(100);
    // A missing item: nothing to draw
    items.delete("b");
    expect(connectorEnds(link, items)).toBeNull();
  });

  it("snaps to nearby edges and centres within the threshold", () => {
    const others = [{ x: 100, y: 0, w: 100, h: 100 }];
    const near = snapRect({ x: 203, y: 300, w: 50, h: 50 }, others, 6);
    expect(near.dx).toBe(-3);
    expect(near.guides).toContainEqual({ axis: "x", at: 200 });
    const far = snapRect({ x: 230, y: 300, w: 50, h: 50 }, others, 6);
    expect(far).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

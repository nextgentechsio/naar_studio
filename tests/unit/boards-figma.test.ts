import { describe, expect, it } from "vitest";
import { itemIdFor, nearestColor, parseFigmaLink, planImport, textSize, type FigmaNode } from "@/lib/boards/figma";
import { cleanItem } from "@/lib/boards/shared";

// --------------------------------------------------
// Naar Boards: import from Figma (links, and turning a
// FigJam page into board items)
// --------------------------------------------------

const box = (x: number, y: number, width = 200, height = 200) => ({ absoluteBoundingBox: { x, y, width, height } });
const solid = (r: number, g: number, b: number) => [{ type: "SOLID", color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }];

describe("links", () => {
  it("reads FigJam and Figma links, with or without a node", () => {
    expect(parseFigmaLink("https://www.figma.com/board/FMLH8zdfOYQXD8iQEQOpVP/TMBC-x-IPL-AD?node-id=0-1&p=f&t=abc-0")).toEqual({
      fileKey: "FMLH8zdfOYQXD8iQEQOpVP",
      nodeId: "0:1",
    });
    expect(parseFigmaLink("https://figma.com/design/AbCdEfGhIjKlMnOp/Name")).toEqual({ fileKey: "AbCdEfGhIjKlMnOp", nodeId: null });
    expect(parseFigmaLink("https://www.figma.com/file/AbCdEfGhIjKlMnOp")).toMatchObject({ fileKey: "AbCdEfGhIjKlMnOp" });
  });

  it("refuses anything that isn't a Figma file link", () => {
    for (const link of ["", "figma.com/board/AbCdEfGhIjKlMnOp", "http://www.figma.com/board/AbCdEfGhIjKlMnOp", "https://evil.com/board/AbCdEfGhIjKlMnOp", "https://figma.com.evil.com/board/AbCdEfGhIjKlMnOp", "https://www.figma.com/files/recents", 42]) {
      expect(parseFigmaLink(link), String(link)).toBeNull();
    }
  });
});

describe("colours and sizes", () => {
  it("matches Figma colours to the board's", () => {
    expect(nearestColor({ r: 1, g: 0.85, b: 0.4 }, "gray")).toBe("yellow");
    expect(nearestColor({ r: 0.95, g: 0.3, b: 0.5 }, "gray")).toBe("pink");
    expect(nearestColor({ r: 0.3, g: 0.6, b: 1 }, "gray")).toBe("blue");
    expect(nearestColor({ r: 0.5, g: 0.8, b: 0.4 }, "gray")).toBe("green");
    expect(nearestColor({ r: 0.9, g: 0.9, b: 0.9 }, "yellow")).toBe("gray");
    expect(nearestColor(undefined, "violet")).toBe("violet");
  });

  it("maps font sizes to the board's text sizes", () => {
    expect([12, 24, 40, 96, undefined].map(textSize)).toEqual(["s", "m", "l", "xl", "m"]);
  });
});

describe("planning the items", () => {
  const page: FigmaNode = {
    id: "0:1",
    type: "CANVAS",
    children: [
      {
        id: "1:1",
        type: "SECTION",
        name: "Ideas",
        ...box(1000, 500, 1200, 800),
        children: [
          { id: "1:2", type: "STICKY", characters: "Introduce stats", fills: solid(255, 199, 140), ...box(1050, 550) },
          { id: "1:3", type: "SHAPE_WITH_TEXT", shapeType: "DIAMOND", characters: "Decide", fills: solid(150, 200, 255), ...box(1400, 550) },
          { id: "1:4", type: "SHAPE_WITH_TEXT", shapeType: "STAR", characters: "", ...box(1700, 550, 100, 100) },
        ],
      },
      { id: "2:1", type: "TEXT", characters: "How might we…", style: { fontSize: 48 }, ...box(1000, 300, 600, 60) },
      { id: "2:2", type: "RECTANGLE", name: "Hero shot", fills: [{ type: "IMAGE", imageRef: "ref-hero" }], ...box(2400, 500, 640, 360) },
      { id: "2:3", type: "CONNECTOR", connectorStart: { endpointNodeId: "1:2" }, connectorEnd: { endpointNodeId: "1:3" }, characters: "then", ...box(1250, 600, 150, 10) },
      { id: "2:4", type: "CONNECTOR", connectorStart: { endpointNodeId: "1:2" }, connectorEnd: { endpointNodeId: "9:9" }, ...box(1250, 600, 150, 10) },
      { id: "2:5", type: "STAMP", name: "thumbs up", ...box(1100, 700, 60, 60) },
      { id: "2:6", type: "GROUP", ...box(3200, 500, 200, 200), children: [{ id: "2:7", type: "STICKY", characters: "grouped", ...box(3200, 500) }] },
      { id: "2:8", type: "STICKY", characters: "hidden", visible: false, ...box(0, 0) },
      { id: "2:9", type: "VECTOR", name: "marker", ...box(1500, 900, 300, 40) },
    ],
  };
  const plan = planImport(page, { figjam: true });
  const byId = (nodeId: string) => plan.items.find((item) => item.id === itemIdFor(nodeId));

  it("turns sticky notes, shapes, text, sections and connectors into board items", () => {
    expect(byId("1:1")).toMatchObject({ type: "frame", x: 0, y: 200, w: 1200, h: 800, data: { title: "Ideas" } });
    expect(byId("1:2")).toMatchObject({ type: "sticky", x: 50, y: 250, data: { text: "Introduce stats", color: "orange" } });
    expect(byId("1:3")).toMatchObject({ type: "shape", data: { shape: "diamond", color: "blue", text: "Decide" } });
    expect(byId("2:1")).toMatchObject({ type: "text", x: 0, y: 0, data: { text: "How might we…", size: "l" } });
    expect(byId("2:3")).toMatchObject({ type: "connector", data: { from: { id: itemIdFor("1:2") }, to: { id: itemIdFor("1:3") }, label: "then" } });
    expect(byId("2:7")).toMatchObject({ type: "sticky", data: { text: "grouped" } });
  });

  it("brings pictures as their original file, and renders what has no match", () => {
    expect(plan.pending).toEqual(
      expect.arrayContaining([
        { kind: "image", itemId: itemIdFor("2:2"), imageRef: "ref-hero", name: "Hero shot" },
        { kind: "render", itemId: itemIdFor("1:4"), nodeId: "1:4", name: expect.any(String) },
        { kind: "render", itemId: itemIdFor("2:5"), nodeId: "2:5", name: "thumbs up" },
        { kind: "render", itemId: itemIdFor("2:9"), nodeId: "2:9", name: "marker" },
      ])
    );
    expect(byId("2:5")).toMatchObject({ type: "image", w: 60, h: 60 });
  });

  it("leaves out hidden things and connectors to nothing", () => {
    expect(byId("2:8")).toBeUndefined();
    expect(byId("2:4")).toBeUndefined();
    expect(plan.skipped).toBe(1);
  });

  it("keeps the section under its contents, in Figma's order", () => {
    expect(byId("1:1")!.z).toBeLessThan(byId("1:2")!.z);
    expect(byId("1:2")!.z).toBeLessThan(byId("1:3")!.z);
  });

  it("makes items the board accepts once pictures have addresses", () => {
    for (const item of plan.items) {
      const ready = item.type === "image" ? { ...item, data: { ...item.data, url: "https://blob.example/x.png" } } : item;
      expect(cleanItem(ready), item.id).not.toBeNull();
    }
  });

  it("keeps a design file's frames exactly as drawn", () => {
    const design = planImport({ id: "0:1", type: "CANVAS", children: [{ id: "3:1", type: "FRAME", name: "Home", ...box(0, 0, 1440, 900), children: [] }] }, { figjam: false });
    expect(design.items).toEqual([expect.objectContaining({ type: "image" })]);
    expect(design.pending).toEqual([{ kind: "render", itemId: itemIdFor("3:1"), nodeId: "3:1", name: "Home" }]);
  });
});

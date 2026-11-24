import {
  MAX_ITEMS,
  MAX_SIZE,
  MIN_SIZE,
  type Anchor,
  type BoardItem,
  type ShapeKind,
  type StickyColor,
  type TextSize,
} from "./shared";

// --------------------------------------------------
// NAAR BOARDS: IMPORT FROM FIGMA (FigJam or Figma links)
//
// Reads a board through Figma's REST API with the
// studio's read-only token (FIGMA_ACCESS_TOKEN) and turns
// it into board items:
//   sticky note → sticky, shape with text → shape,
//   text → text, connector → connector (still attached),
//   section → frame, picture → picture (the original file)
// Anything with no match here (stamps, emoji, widgets,
// tables, drawings, other shapes) is rendered by Figma as
// a PNG and placed as a picture, so the whole board comes
// across. A one-time copy: later changes in Figma don't
// sync.
//
// This file only reads Figma and plans the items; the
// downloads and the board itself are in importFigmaBoard
// (server.ts).
// --------------------------------------------------

const API = () => (process.env.FIGMA_API_URL || "https://api.figma.com").replace(/\/+$/, "");
const TIMEOUT_MS = 60_000;
// Nodes rendered per request. Figma counts file reads and
// renders against a small monthly allowance on most
// accounts (developers.figma.com/docs/rest-api/rate-limits),
// so an import asks as few times as it can: one read of
// the file, one list of picture fills, and as few render
// requests as possible
const RENDER_BATCH = 200;
// Pictures Figma renders for one import, at most
export const MAX_RENDERED = 400;

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // Seconds Figma said to wait (a 429)
    readonly retryAfter: number | null = null
  ) {
    super(message);
  }
}

// "3 days", "2 hours", "5 minutes"
export function waitText(seconds: number): string {
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"}`;
  if (seconds >= 36 * 3600) return unit(Math.ceil(seconds / 86_400), "day");
  if (seconds >= 90 * 60) return unit(Math.ceil(seconds / 3600), "hour");
  return unit(Math.max(1, Math.ceil(seconds / 60)), "minute");
}

// What to say when Figma says "too many": how long, and
// why it can be days (the account's monthly allowance)
export function rateLimitMessage(retryAfter: number | null, limitType: string | null): string {
  const wait = retryAfter && retryAfter > 0 ? ` Figma says to try again in ${waitText(retryAfter)}.` : " Try again later.";
  const why =
    limitType === "low" || (retryAfter ?? 0) > 3600
      ? " The studio's Figma account has a View or Collab seat, which Figma allows only a few file reads a month. A Dev or Full seat on a paid Figma plan raises that to many a minute."
      : "";
  return `Figma has paused imports for the studio's Figma account.${wait}${why}`;
}

export function figmaConfigured(): boolean {
  return Boolean(process.env.FIGMA_ACCESS_TOKEN?.trim());
}

// --------------------------------------------------
// THE LINK
// --------------------------------------------------

// figma.com/board|file|design|proto/<key>/<name>?node-id=1-2
export function parseFigmaLink(raw: unknown): { fileKey: string; nodeId: string | null } | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/(^|\.)figma\.com$/.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:board|file|design|proto)\/([A-Za-z0-9]{10,64})(?:\/|$)/);
  if (!match) return null;
  const node = url.searchParams.get("node-id");
  const nodeId = node && /^[\w:;-]{1,100}$/.test(node) ? node.replace(/-/g, ":") : null;
  return { fileKey: match[1], nodeId };
}

// --------------------------------------------------
// FIGMA'S API
// --------------------------------------------------

async function figmaGet<T>(path: string): Promise<T> {
  const token = process.env.FIGMA_ACCESS_TOKEN?.trim();
  if (!token) throw new FigmaError("Figma import isn't set up: add FIGMA_ACCESS_TOKEN on the server.", 501);
  let response: Response;
  try {
    response = await fetch(`${API()}${path}`, {
      headers: { "X-Figma-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FigmaError("Couldn't reach Figma. Try again in a moment.", 502);
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: handled by the status below
  }
  if (response.ok) return body as T;

  const message = String(body.err ?? body.message ?? "");
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : null;
    throw new FigmaError(rateLimitMessage(retryAfter, response.headers.get("x-figma-rate-limit-type")), 429, retryAfter);
  }
  if (/scope/i.test(message)) {
    throw new FigmaError("The Figma token can't read files. Make a new token with File content set to Read-only.", 502);
  }
  if (/token/i.test(message) && response.status === 403) {
    throw new FigmaError("The Figma token isn't valid any more (expired or revoked). Make a new one.", 502);
  }
  if (response.status === 403 || response.status === 404) {
    throw new FigmaError(
      "Figma won't open that file for the studio's Figma account. Ask the client to set the link to “Anyone with the link can view”, or to share the file with that account.",
      403
    );
  }
  throw new FigmaError(`Figma refused the request (${response.status}). Try again in a moment.`, 502);
}

// --------------------------------------------------
// THE NODES WE READ
// --------------------------------------------------

type Color = { r: number; g: number; b: number; a?: number };
type Paint = { type: string; visible?: boolean; opacity?: number; color?: Color; imageRef?: string };
type Endpoint = { endpointNodeId?: string; position?: { x: number; y: number } };

export type FigmaNode = {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: Paint[];
  characters?: string;
  shapeType?: string;
  style?: { fontSize?: number };
  connectorStart?: Endpoint;
  connectorEnd?: Endpoint;
};

export type FigmaFile = { name: string; editorType?: string; document: FigmaNode };

// --------------------------------------------------
// FROM NODES TO ITEMS
// --------------------------------------------------

// The hue of each of our colours (ItemView's COLORS), in
// degrees. Figma colours match by hue, so a pale FigJam
// orange and a strong orange both read as orange; colours
// with almost no colour in them are gray.
const HUES: [Exclude<StickyColor, "gray">, number][] = [
  ["yellow", 47],
  ["orange", 31],
  ["pink", 342],
  ["violet", 255],
  ["blue", 210],
  ["teal", 171],
  ["green", 99],
];

export function nearestColor(color: Color | undefined, fallback: StickyColor): StickyColor {
  if (!color) return fallback;
  const { r, g, b } = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 0.08) return "gray";
  const hue =
    (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60;
  let best: StickyColor = fallback;
  let bestDistance = Infinity;
  for (const [name, at] of HUES) {
    const around = Math.abs(hue - at);
    const distance = Math.min(around, 360 - around);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

export function textSize(fontSize: number | undefined): TextSize {
  const size = fontSize ?? 24;
  return size < 20 ? "s" : size < 32 ? "m" : size < 52 ? "l" : "xl";
}

const SHAPES: Record<string, ShapeKind> = {
  SQUARE: "rect",
  ROUNDED_RECTANGLE: "rect",
  ELLIPSE: "ellipse",
  DIAMOND: "diamond",
  TRIANGLE_UP: "triangle",
};

// Item ids may only use letters, digits, _ and -
export const itemIdFor = (nodeId: string) => `fg-${nodeId.replace(/[^\w-]/g, "_")}`.slice(0, 64);

const solidFill = (node: FigmaNode) =>
  node.fills?.find((paint) => paint.type === "SOLID" && paint.visible !== false && (paint.opacity ?? 1) > 0)?.color;
const imageFill = (node: FigmaNode) => node.fills?.find((paint) => paint.type === "IMAGE" && paint.visible !== false && paint.imageRef);

// What the import still has to fetch for an item
export type Pending =
  | { kind: "image"; itemId: string; imageRef: string; name: string }
  | { kind: "render"; itemId: string; nodeId: string; name: string };

export type Plan = {
  items: BoardItem[];
  // Image items whose url is filled in once downloaded
  pending: Pending[];
  // Nodes left out (over the limits, or of no size)
  skipped: number;
};

// The items for a page (or one node of it), placed so the
// board starts near 0,0
export function planImport(root: FigmaNode, options: { figjam: boolean }): Plan {
  const items: BoardItem[] = [];
  const pending: Pending[] = [];
  let skipped = 0;
  let renders = 0;
  let z = 0;

  const top = root.type === "CANVAS" ? (root.children ?? []) : [root];
  const boxes = top.flatMap((node) => (node.visible !== false && node.absoluteBoundingBox ? [node.absoluteBoundingBox] : []));
  const originX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const originY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;

  const place = (node: FigmaNode) => {
    const box = node.absoluteBoundingBox!;
    const size = (value: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, value));
    return { x: box.x - originX, y: box.y - originY, w: size(box.width), h: size(box.height), z: ++z };
  };
  const full = () => items.length + pending.length >= MAX_ITEMS;

  const render = (node: FigmaNode) => {
    if (renders >= MAX_RENDERED || full()) {
      skipped++;
      return;
    }
    renders++;
    const id = itemIdFor(node.id);
    items.push({ id, type: "image", ...place(node), data: { url: "", name: node.name ?? "Figma", contentType: "image/png" } });
    pending.push({ kind: "render", itemId: id, nodeId: node.id, name: node.name ?? "Figma" });
  };

  const visit = (node: FigmaNode) => {
    if (node.visible === false) return;
    const box = node.absoluteBoundingBox;
    if (node.type !== "CONNECTOR" && (!box || box.width <= 0 || box.height <= 0)) {
      skipped++;
      return;
    }
    if (full()) {
      skipped++;
      return;
    }
    const id = itemIdFor(node.id);

    switch (node.type) {
      case "SECTION":
        items.push({ id, type: "frame", ...place(node), data: { title: node.name ?? "" } });
        node.children?.forEach(visit);
        return;

      case "FRAME":
        // FigJam frames hold board items; a design frame is
        // kept exactly as drawn
        if (!options.figjam) return render(node);
        items.push({ id, type: "frame", ...place(node), data: { title: node.name ?? "" } });
        node.children?.forEach(visit);
        return;

      case "GROUP":
        node.children?.forEach(visit);
        return;

      case "STICKY":
        items.push({ id, type: "sticky", ...place(node), data: { text: node.characters ?? "", color: nearestColor(solidFill(node), "yellow") } });
        return;

      case "SHAPE_WITH_TEXT": {
        const shape = SHAPES[node.shapeType ?? ""];
        if (!shape) return render(node);
        items.push({ id, type: "shape", ...place(node), data: { shape, color: nearestColor(solidFill(node), "blue"), text: node.characters ?? "" } });
        return;
      }

      case "TEXT":
        items.push({ id, type: "text", ...place(node), data: { text: node.characters ?? "", size: textSize(node.style?.fontSize) } });
        return;

      case "CONNECTOR": {
        const end = (point: Endpoint | undefined, corner: "start" | "end"): Anchor | null => {
          if (point?.endpointNodeId) return { id: itemIdFor(point.endpointNodeId) };
          if (point?.position) return { x: point.position.x - originX, y: point.position.y - originY };
          if (!box) return null;
          return corner === "start" ? { x: box.x - originX, y: box.y - originY } : { x: box.x + box.width - originX, y: box.y + box.height - originY };
        };
        const from = end(node.connectorStart, "start");
        const to = end(node.connectorEnd, "end");
        if (!from || !to) {
          skipped++;
          return;
        }
        items.push({ id, type: "connector", x: 0, y: 0, w: 0, h: 0, z: ++z, data: { from, to, label: (node.characters ?? "").slice(0, 200) } });
        return;
      }

      case "RECTANGLE":
      case "ELLIPSE": {
        const picture = imageFill(node);
        if (picture?.imageRef) {
          items.push({ id, type: "image", ...place(node), data: { url: "", name: node.name ?? "Picture", contentType: "image/png" } });
          pending.push({ kind: "image", itemId: id, imageRef: picture.imageRef, name: node.name ?? "Picture" });
          return;
        }
        const color = solidFill(node);
        if (!color) return render(node);
        items.push({ id, type: "shape", ...place(node), data: { shape: node.type === "ELLIPSE" ? "ellipse" : "rect", color: nearestColor(color, "blue"), text: "" } });
        return;
      }

      default:
        // Stamps, emoji, widgets, embeds, tables, code
        // blocks, drawings, other shapes, components…
        return render(node);
    }
  };

  top.forEach(visit);

  // A connector to something that wasn't imported points
  // at nothing: leave it out
  const ids = new Set(items.map((item) => item.id));
  const kept = items.filter(
    (item) =>
      item.type !== "connector" ||
      [item.data.from, item.data.to].every((anchor) => !("id" in anchor) || ids.has(anchor.id))
  );
  return { items: kept, pending, skipped: skipped + (items.length - kept.length) };
}

// --------------------------------------------------
// READING A FILE
// --------------------------------------------------

export async function readFigmaFile(fileKey: string, nodeId: string | null): Promise<{ name: string; root: FigmaNode; figjam: boolean }> {
  const file = await figmaGet<FigmaFile>(`/v1/files/${encodeURIComponent(fileKey)}`);
  const pages = file.document?.children ?? [];
  if (!pages.length) throw new FigmaError("That Figma file is empty.", 422);

  let root: FigmaNode | undefined;
  if (nodeId) {
    const find = (node: FigmaNode): FigmaNode | undefined =>
      node.id === nodeId ? node : node.children?.map(find).find(Boolean);
    root = find(file.document);
    if (root?.type === "DOCUMENT") root = undefined;
  }
  root ??= pages[0];
  return { name: file.name || "Figma board", root, figjam: file.editorType === "figjam" };
}

// Download addresses for picture fills (originals)
export async function imageFillUrls(fileKey: string): Promise<Record<string, string>> {
  const body = await figmaGet<{ meta?: { images?: Record<string, string | null> } }>(`/v1/files/${encodeURIComponent(fileKey)}/images`);
  const out: Record<string, string> = {};
  for (const [ref, url] of Object.entries(body.meta?.images ?? {})) if (url) out[ref] = url;
  return out;
}

// PNGs Figma renders of nodes, in batches
export async function renderNodes(fileKey: string, nodeIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let start = 0; start < nodeIds.length; start += RENDER_BATCH) {
    const ids = nodeIds.slice(start, start + RENDER_BATCH);
    const body = await figmaGet<{ images?: Record<string, string | null> }>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(ids.join(","))}&format=png&scale=2`
    );
    for (const [id, url] of Object.entries(body.images ?? {})) if (url) out[id] = url;
  }
  return out;
}

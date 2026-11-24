// --------------------------------------------------
// NAAR BOARDS: THE MODEL (shared by server and browser)
//
// A board is a set of items on an infinite canvas. Every
// change is an operation (put, patch, delete), so the
// same operations save to the server, undo (each has an
// inverse) and, later, travel to collaborators.
// --------------------------------------------------

export const ITEM_TYPES = ["sticky", "text", "shape", "image", "video", "frame", "connector", "draw"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STICKY_COLORS = ["yellow", "orange", "pink", "violet", "blue", "teal", "green", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export const SHAPE_KINDS = ["rect", "ellipse", "diamond", "triangle"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const TEXT_SIZES = ["s", "m", "l", "xl"] as const;

// Marker colours
export const PEN_COLORS = ["ink", "red", "blue", "green", "violet", "orange"] as const;
export type PenColor = (typeof PEN_COLORS)[number];
export const MAX_DRAW_POINTS = 3000;
export type TextSize = (typeof TEXT_SIZES)[number];

// Where a connector end is: on an item (follows it), or a
// free point on the canvas
export type Anchor = { id: string } | { x: number; y: number };

export type ItemData = {
  sticky: { text: string; color: StickyColor };
  text: { text: string; size: TextSize };
  shape: { shape: ShapeKind; color: StickyColor; text: string };
  image: { url: string; name: string; contentType: string };
  video: { url: string; name: string; contentType: string };
  frame: { title: string };
  connector: { from: Anchor; to: Anchor; label: string };
  // A marker stroke: flat [x, y, x, y, …] in a box of
  // ow × oh (the size it was drawn at), stretched to w × h
  draw: { points: number[]; color: PenColor; width: number; ow: number; oh: number };
};

type ItemOf<T extends ItemType> = {
  id: string;
  type: T;
  x: number;
  y: number;
  w: number;
  h: number;
  // Stacking order; higher is in front
  z: number;
  data: ItemData[T];
};

export type BoardItem = { [T in ItemType]: ItemOf<T> }[ItemType];

// A partial change to one item; data is merged key by key
export type ItemPatch = Partial<Pick<BoardItem, "x" | "y" | "w" | "h" | "z">> & {
  data?: Record<string, unknown>;
};

export type BoardOp =
  | { kind: "put"; item: BoardItem }
  | { kind: "patch"; id: string; set: ItemPatch }
  | { kind: "delete"; id: string };

export type PublicBoard = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  coverUrl: string | null;
  itemCount: number;
  // Made by "Import from Figma" (or a copy of one)
  importedFrom: "figma" | null;
  createdAt: string;
  updatedAt: string;
};

// --------------------------------------------------
// LIMITS
// --------------------------------------------------

export const MAX_BOARD_NAME = 80;
export const MAX_ITEMS = 5000;
export const MAX_OPS_PER_SAVE = 500;
export const MAX_TEXT = 5000;
export const MAX_COORD = 1_000_000;
export const MIN_SIZE = 8;
export const MAX_SIZE = 20_000;

// --------------------------------------------------
// VALIDATION: shapes from the network are checked and
// cleaned on the server (and trusted nowhere else)
// --------------------------------------------------

const isId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
const num = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
const text = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

function cleanAnchor(value: unknown): Anchor | null {
  if (!value || typeof value !== "object") return null;
  const anchor = value as Record<string, unknown>;
  if (isId(anchor.id)) return { id: anchor.id };
  const x = num(anchor.x, -MAX_COORD, MAX_COORD);
  const y = num(anchor.y, -MAX_COORD, MAX_COORD);
  return x === null || y === null ? null : { x, y };
}

function cleanData(type: ItemType, raw: unknown): BoardItem["data"] | null {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (type) {
    case "sticky":
      return { text: text(data.text), color: oneOf(STICKY_COLORS, data.color, "yellow") };
    case "text":
      return { text: text(data.text), size: oneOf(TEXT_SIZES, data.size, "m") };
    case "shape":
      return { shape: oneOf(SHAPE_KINDS, data.shape, "rect"), color: oneOf(STICKY_COLORS, data.color, "blue"), text: text(data.text) };
    case "image":
    case "video": {
      if (typeof data.url !== "string" || !/^https?:\/\//.test(data.url) || data.url.length > 2000) return null;
      return { url: data.url, name: text(data.name, 200), contentType: text(data.contentType, 100) };
    }
    case "frame":
      return { title: text(data.title, 200) };
    case "draw": {
      const points = Array.isArray(data.points) ? data.points : [];
      if (points.length < 4 || points.length > MAX_DRAW_POINTS * 2 || points.length % 2) return null;
      if (!points.every((value) => typeof value === "number" && Number.isFinite(value) && value >= -10 && value <= MAX_SIZE + 10)) return null;
      const ow = num(data.ow, 1, MAX_SIZE);
      const oh = num(data.oh, 1, MAX_SIZE);
      if (ow === null || oh === null) return null;
      return {
        points: points.map((value) => Math.round((value as number) * 10) / 10),
        color: oneOf(PEN_COLORS, data.color, "ink"),
        width: num(data.width, 1, 40) ?? 4,
        ow,
        oh,
      };
    }
    case "connector": {
      const from = cleanAnchor(data.from);
      const to = cleanAnchor(data.to);
      if (!from || !to) return null;
      return { from, to, label: text(data.label, 200) };
    }
  }
}

export function cleanItem(raw: unknown): BoardItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isId(item.id) || !ITEM_TYPES.includes(item.type as ItemType)) return null;
  const type = item.type as ItemType;
  const x = num(item.x, -MAX_COORD, MAX_COORD);
  const y = num(item.y, -MAX_COORD, MAX_COORD);
  const w = num(item.w, type === "connector" ? 0 : MIN_SIZE, MAX_SIZE);
  const h = num(item.h, type === "connector" ? 0 : MIN_SIZE, MAX_SIZE);
  const z = num(item.z, -1e9, 1e9);
  const data = cleanData(type, item.data);
  if (x === null || y === null || w === null || h === null || z === null || !data) return null;
  return { id: item.id, type, x, y, w, h, z, data } as BoardItem;
}

export function cleanOp(raw: unknown): BoardOp | null {
  if (!raw || typeof raw !== "object") return null;
  const op = raw as Record<string, unknown>;
  if (op.kind === "put") {
    const item = cleanItem(op.item);
    return item ? { kind: "put", item } : null;
  }
  if (op.kind === "delete") return isId(op.id) ? { kind: "delete", id: op.id } : null;
  if (op.kind === "patch" && isId(op.id) && op.set && typeof op.set === "object") {
    const set = op.set as Record<string, unknown>;
    const out: ItemPatch = {};
    for (const key of ["x", "y"] as const) {
      const value = num(set[key], -MAX_COORD, MAX_COORD);
      if (value !== null) out[key] = value;
    }
    for (const key of ["w", "h"] as const) {
      const value = num(set[key], 0, MAX_SIZE);
      if (value !== null) out[key] = value;
    }
    const z = num(set.z, -1e9, 1e9);
    if (z !== null) out.z = z;
    if (set.data && typeof set.data === "object" && !Array.isArray(set.data)) {
      // Checked against the item's type when applied
      out.data = set.data as Record<string, unknown>;
    }
    return Object.keys(out).length ? { kind: "patch", id: op.id, set: out } : null;
  }
  return null;
}

// An item with a patch applied, re-checked as a whole
export function patchItem(item: BoardItem, set: ItemPatch): BoardItem | null {
  return cleanItem({ ...item, ...set, data: set.data ? { ...item.data, ...set.data } : item.data });
}

// --------------------------------------------------
// APPLYING OPERATIONS (and their inverses, for undo)
// --------------------------------------------------

export type ItemMap = Map<string, BoardItem>;

export function applyOp(items: ItemMap, op: BoardOp): void {
  if (op.kind === "put") items.set(op.item.id, op.item);
  else if (op.kind === "delete") items.delete(op.id);
  else {
    const current = items.get(op.id);
    if (!current) return;
    const next = patchItem(current, op.set);
    if (next) items.set(op.id, next);
  }
}

// What undoes `op`, given the items before it applied
export function invertOp(before: ItemMap, op: BoardOp): BoardOp | null {
  if (op.kind === "put") {
    const previous = before.get(op.item.id);
    return previous ? { kind: "put", item: previous } : { kind: "delete", id: op.item.id };
  }
  if (op.kind === "delete") {
    const previous = before.get(op.id);
    return previous ? { kind: "put", item: previous } : null;
  }
  const previous = before.get(op.id);
  if (!previous) return null;
  const set: ItemPatch = {};
  for (const key of ["x", "y", "w", "h", "z"] as const) {
    if (op.set[key] !== undefined) set[key] = previous[key];
  }
  if (op.set.data) {
    const data = previous.data as Record<string, unknown>;
    set.data = Object.fromEntries(Object.keys(op.set.data).map((key) => [key, data[key]]));
  }
  return { kind: "patch", id: op.id, set };
}

// Applies ops in order and returns the inverse sequence
// (to undo, apply it as is)
export function applyWithInverse(items: ItemMap, ops: BoardOp[]): BoardOp[] {
  const inverse: BoardOp[] = [];
  for (const op of ops) {
    const undo = invertOp(items, op);
    applyOp(items, op);
    if (undo) inverse.unshift(undo);
  }
  return inverse;
}

// --------------------------------------------------
// GEOMETRY
// --------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

const center = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

// Where the line from a rect's centre towards `toward`
// leaves the rect (a connector ends on an item's edge)
export function edgePoint(rect: Rect, toward: Point): Point {
  const c = center(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const sx = dx ? rect.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? rect.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

// The two ends of a connector, in canvas coordinates
export function connectorEnds(item: Extract<BoardItem, { type: "connector" }>, items: ItemMap): [Point, Point] | null {
  const rectOf = (anchor: Anchor): Rect | null => {
    if (!("id" in anchor)) return null;
    const target = items.get(anchor.id);
    return target && target.type !== "connector" ? target : null;
  };
  const pointOf = (anchor: Anchor) => ("id" in anchor ? null : { x: anchor.x, y: anchor.y });
  const fromRect = rectOf(item.data.from);
  const toRect = rectOf(item.data.to);
  const fromPoint = pointOf(item.data.from);
  const toPoint = pointOf(item.data.to);
  if ((!fromRect && !fromPoint) || (!toRect && !toPoint)) return null;
  const fromCenter = fromRect ? center(fromRect) : fromPoint!;
  const toCenter = toRect ? center(toRect) : toPoint!;
  return [fromRect ? edgePoint(fromRect, toCenter) : fromPoint!, toRect ? edgePoint(toRect, fromCenter) : toPoint!];
}

// Snapping a moving rect to other rects' edges and centres
export type Guide = { axis: "x" | "y"; at: number };

export function snapRect(moving: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = (rect: Rect) => [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ys = (rect: Rect) => [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
  let bestX: { delta: number; at: number } | null = null;
  let bestY: { delta: number; at: number } | null = null;
  for (const other of others) {
    for (const target of xs(other)) {
      for (const edge of xs(moving)) {
        const delta = target - edge;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, at: target };
      }
    }
    for (const target of ys(other)) {
      for (const edge of ys(moving)) {
        const delta = target - edge;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, at: target };
      }
    }
  }
  const guides: Guide[] = [];
  if (bestX) guides.push({ axis: "x", at: bestX.at });
  if (bestY) guides.push({ axis: "y", at: bestY.at });
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

// Items wholly inside a frame move with it
export function itemsInFrame(frame: Rect & { id: string }, items: Iterable<BoardItem>): BoardItem[] {
  const inside: BoardItem[] = [];
  for (const item of items) {
    if (item.id === frame.id || item.type === "connector") continue;
    if (contains(frame, item)) inside.push(item);
  }
  return inside;
}

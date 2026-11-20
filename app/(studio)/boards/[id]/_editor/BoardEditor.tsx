"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  boundsOf,
  connectorEnds,
  intersects,
  itemsInFrame,
  normalizeRect,
  snapRect,
  STICKY_COLORS,
  TEXT_SIZES,
  type Anchor,
  type BoardItem,
  type BoardOp,
  type Guide,
  type ItemPatch,
  type Point,
  type PublicBoard,
  type Rect,
  type ShapeKind,
  type StickyColor,
  type TextSize,
} from "@/lib/boards/shared";
import { addBoardAsset, addRemoteBoardAsset, renameBoard } from "@/lib/client/boards";
import { uploadToLibrary } from "@/lib/client/library";
import { errorMessage } from "@/lib/client/http";
import MediaLibraryDialog from "@/app/(studio)/_generate/MediaLibraryDialog";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { cx, Spinner } from "@/app/components/ui/primitives";
import ItemView, { COLORS, EditText } from "./ItemView";
import { useBoard, type BoardStore } from "./useBoard";

// --------------------------------------------------
// THE BOARD EDITOR
//
// Full screen over the studio. The "world" layer holds
// every item in canvas units and moves with one CSS
// transform (pan and zoom); selection, handles and guides
// are drawn in screen units on top so they stay crisp.
// Tools work like FigJam: pick one, use it once, and it
// goes back to Select.
// --------------------------------------------------

type Tool = "select" | "hand" | "sticky" | "text" | "shape" | "connector" | "frame";
type Camera = { x: number; y: number; zoom: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const GRID = 24;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, "");
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: "select", icon: "cursor", label: "Select", key: "V" },
  { tool: "hand", icon: "hand", label: "Hand", key: "H" },
  { tool: "sticky", icon: "sticky", label: "Sticky note", key: "S" },
  { tool: "text", icon: "type", label: "Text", key: "T" },
  { tool: "shape", icon: "shapes", label: "Shape", key: "R" },
  { tool: "connector", icon: "connector", label: "Connector", key: "L" },
  { tool: "frame", icon: "frame", label: "Frame", key: "F" },
];

type Gesture =
  | { type: "pan"; start: Point; cam: Camera }
  | { type: "move"; start: Point; ids: string[]; origins: Map<string, Rect>; moved: boolean; clickedId: string | null; shift: boolean }
  | { type: "marquee"; start: Point; base: Set<string> }
  | { type: "resize"; handle: Handle; bounds: Rect; origins: Map<string, Rect>; keepAspect: boolean }
  | { type: "create"; tool: Tool; start: Point }
  | { type: "connector"; from: Anchor; fromPoint: Point };

export default function BoardEditor({
  board,
  initialItems,
  readOnly = false,
}: {
  board: PublicBoard;
  initialItems: BoardItem[];
  // Someone else's board, opened by the super admin: look,
  // pan and zoom only
  readOnly?: boolean;
}) {
  const store = useBoard(board.id, initialItems);
  const { items } = store;
  const rootRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [linkDraft, setLinkDraft] = useState<[Point, Point] | null>(null);
  const [createDraft, setCreateDraft] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [mediaMenu, setMediaMenu] = useState(false);
  const [adding, setAdding] = useState(0);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(board.name);
  const gestureRef = useRef<Gesture | null>(null);
  const clipboardRef = useRef<BoardItem[]>([]);
  // The mouse's last place on the canvas (pastes land there)
  const lastPointerRef = useRef<Point | null>(null);
  const pasteCountRef = useRef(0);
  const clipboardMarkRef = useRef("");
  const camRef = useRef(cam);
  useEffect(() => {
    camRef.current = cam;
  }, [cam]);
  const [panning, setPanning] = useState(false);
  // The canvas's size on screen, for drawing only what's in view
  const [size, setSize] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const savedNameRef = useRef(board.name);

  // ---------- Coordinates ----------

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = rootRef.current!.getBoundingClientRect();
    const { x, y, zoom } = camRef.current;
    return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
  }, []);

  const toScreen = (point: Point): Point => ({ x: point.x * cam.zoom + cam.x, y: point.y * cam.zoom + cam.y });

  const viewportWorld = useCallback((): Rect => {
    const rect = rootRef.current?.getBoundingClientRect();
    const { x, y, zoom } = camRef.current;
    if (!rect) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: -x / zoom, y: -y / zoom, w: rect.width / zoom, h: rect.height / zoom };
  }, []);

  const zoomTo = useCallback((target: Rect | null, maxZoom = 1) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!target) {
      setCam({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });
      return;
    }
    const pad = 80;
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / Math.max(target.w, 1), (rect.height - pad * 2) / Math.max(target.h, 1), maxZoom));
    setCam({ x: rect.width / 2 - (target.x + target.w / 2) * zoom, y: rect.height / 2 - (target.y + target.h / 2) * zoom, zoom });
  }, []);

  const zoomAt = useCallback((factor: number, screen?: Point) => {
    setCam((current) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const at = screen ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
      const zoom = clampZoom(current.zoom * factor);
      const k = zoom / current.zoom;
      return { zoom, x: at.x - (at.x - current.x) * k, y: at.y - (at.y - current.y) * k };
    });
  }, []);

  // Open on everything there is
  useEffect(() => {
    const all = [...store.getStored().values()].filter((item) => item.type !== "connector");
    zoomTo(boundsOf(all), 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Helpers ----------

  const maxZ = () => Math.max(0, ...[...items.values()].map((item) => item.z));
  const minZ = () => Math.min(0, ...[...items.values()].map((item) => item.z));

  const itemAt = (target: EventTarget | null): BoardItem | null => {
    const id = (target as HTMLElement | null)?.closest?.("[data-item-id]")?.getAttribute("data-item-id");
    return id ? items.get(id) ?? null : null;
  };

  // Moving a frame takes what's inside it along
  const withContents = (ids: string[]): string[] => {
    const out = new Set(ids);
    for (const id of ids) {
      const item = items.get(id);
      if (item?.type === "frame") itemsInFrame(item, items.values()).forEach((inside) => out.add(inside.id));
    }
    return [...out];
  };

  const selectedItems = [...selected].map((id) => items.get(id)).filter((item): item is BoardItem => Boolean(item));
  const selectedBoxes = selectedItems.filter((item) => item.type !== "connector");
  const selectionBounds = boundsOf(selectedBoxes);

  // Deleting items takes connectors attached to them too
  const deleteIds = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      for (const item of store.getStored().values()) {
        if (item.type === "connector" && [item.data.from, item.data.to].some((anchor) => "id" in anchor && gone.has(anchor.id))) gone.add(item.id);
      }
      store.commit([...gone].map((id) => ({ kind: "delete", id })));
      setSelected(new Set());
    },
    [store]
  );

  const place = (item: BoardItem, edit = false) => {
    store.commit([{ kind: "put", item }]);
    setSelected(new Set([item.id]));
    if (edit) setEditingId(item.id);
    setTool("select");
  };

  // ---------- Pointer ----------

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    if (editingId) {
      // Clicking away finishes typing (the text area's blur saves)
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditingId(null);
    }
    setMediaMenu(false);
    rootRef.current?.setPointerCapture(event.pointerId);
    const world = toWorld(event.clientX, event.clientY);
    const screen = { x: event.clientX, y: event.clientY };

    if (readOnly || event.button === 1 || tool === "hand" || spaceDown) {
      gestureRef.current = { type: "pan", start: screen, cam };
      setPanning(true);
      return;
    }

    const hit = itemAt(event.target);

    if (tool === "connector") {
      const from: Anchor = hit && hit.type !== "connector" ? { id: hit.id } : { x: world.x, y: world.y };
      gestureRef.current = { type: "connector", from, fromPoint: world };
      setLinkDraft([world, world]);
      return;
    }

    if (tool !== "select") {
      gestureRef.current = { type: "create", tool, start: world };
      return;
    }

    if (hit) {
      const shift = event.shiftKey;
      let next = new Set(selected);
      if (shift) {
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
      } else if (!next.has(hit.id)) {
        next = new Set([hit.id]);
      }
      setSelected(next);
      const ids = withContents([...next].filter((id) => items.get(id)?.type !== "connector"));
      const origins = new Map(ids.map((id) => [id, { ...items.get(id)! }] as const));
      gestureRef.current = { type: "move", start: world, ids, origins, moved: false, clickedId: hit.id, shift };
      return;
    }

    gestureRef.current = { type: "marquee", start: world, base: event.shiftKey ? new Set(selected) : new Set() };
    if (!event.shiftKey) setSelected(new Set());
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerRef.current = toWorld(event.clientX, event.clientY);
    const gesture = gestureRef.current;
    if (!gesture) return;
    const world = toWorld(event.clientX, event.clientY);

    if (gesture.type === "pan") {
      setCam({ ...gesture.cam, x: gesture.cam.x + event.clientX - gesture.start.x, y: gesture.cam.y + event.clientY - gesture.start.y });
      return;
    }

    if (gesture.type === "move") {
      let dx = world.x - gesture.start.x;
      let dy = world.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * cam.zoom < 3) return;
      gesture.moved = true;
      // Snap the moving group to what's around it
      const moving = boundsOf([...gesture.origins.values()].map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy })));
      let found: Guide[] = [];
      if (moving && !event.altKey) {
        const view = viewportWorld();
        const others = [...items.values()].filter((item) => item.type !== "connector" && !gesture.origins.has(item.id) && intersects(item, view));
        const snap = snapRect(moving, others, 6 / cam.zoom);
        dx += snap.dx;
        dy += snap.dy;
        found = snap.guides;
      }
      setGuides(found);
      store.setDrafts(new Map([...gesture.origins].map(([id, rect]) => [id, { x: rect.x + dx, y: rect.y + dy }])));
      return;
    }

    if (gesture.type === "marquee") {
      const rect = normalizeRect(gesture.start, world);
      setMarquee(rect);
      const hits = new Set(gesture.base);
      for (const item of items.values()) {
        if (item.type === "connector") continue;
        const inside = item.type === "frame" ? rect.x <= item.x && rect.y <= item.y && rect.x + rect.w >= item.x + item.w && rect.y + rect.h >= item.y + item.h : intersects(rect, item);
        if (inside) hits.add(item.id);
      }
      setSelected(hits);
      return;
    }

    if (gesture.type === "resize") {
      const { bounds, handle } = gesture;
      let left = bounds.x;
      let top = bounds.y;
      let right = bounds.x + bounds.w;
      let bottom = bounds.y + bounds.h;
      if (handle.includes("w")) left = Math.min(world.x, right - 8);
      if (handle.includes("e")) right = Math.max(world.x, left + 8);
      if (handle.includes("n")) top = Math.min(world.y, bottom - 8);
      if (handle.includes("s")) bottom = Math.max(world.y, top + 8);
      let sx = (right - left) / bounds.w;
      let sy = (bottom - top) / bounds.h;
      if (gesture.keepAspect || event.shiftKey) {
        const s = handle.length === 1 ? (handle === "n" || handle === "s" ? sy : sx) : Math.max(sx, sy);
        sx = s;
        sy = s;
        if (handle.includes("w")) left = right - bounds.w * s;
        else right = left + bounds.w * s;
        if (handle.includes("n")) top = bottom - bounds.h * s;
        else bottom = top + bounds.h * s;
      }
      store.setDrafts(
        new Map(
          [...gesture.origins].map(([id, rect]) => [
            id,
            { x: left + (rect.x - bounds.x) * sx, y: top + (rect.y - bounds.y) * sy, w: Math.max(8, rect.w * sx), h: Math.max(8, rect.h * sy) },
          ])
        )
      );
      return;
    }

    if (gesture.type === "create") {
      if (gesture.tool === "shape" || gesture.tool === "frame") setCreateDraft(normalizeRect(gesture.start, world));
      return;
    }

    if (gesture.type === "connector") {
      setLinkDraft([gesture.fromPoint, world]);
    }
  };

  const forgetPointer = () => {
    lastPointerRef.current = null;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPanning(false);
    setGuides([]);
    setMarquee(null);
    if (!gesture) return;
    const world = toWorld(event.clientX, event.clientY);

    if (gesture.type === "move") {
      if (gesture.moved) {
        const ops: BoardOp[] = [];
        for (const [id, origin] of gesture.origins) {
          const now = items.get(id);
          if (now && (now.x !== origin.x || now.y !== origin.y)) ops.push({ kind: "patch", id, set: { x: now.x, y: now.y } });
        }
        store.commit(ops);
      } else if (!gesture.shift && gesture.clickedId) {
        setSelected(new Set([gesture.clickedId]));
      }
      store.setDrafts(new Map());
      return;
    }

    if (gesture.type === "resize") {
      const ops: BoardOp[] = [];
      for (const id of gesture.origins.keys()) {
        const now = items.get(id);
        if (now) ops.push({ kind: "patch", id, set: { x: now.x, y: now.y, w: now.w, h: now.h } });
      }
      store.commit(ops);
      return;
    }

    if (gesture.type === "create") {
      setCreateDraft(null);
      const dragged = normalizeRect(gesture.start, world);
      const big = dragged.w * cam.zoom > 8 && dragged.h * cam.zoom > 8;
      const z = maxZ() + 1;
      if (gesture.tool === "sticky") {
        place({ id: newId(), type: "sticky", x: world.x - 110, y: world.y - 110, w: 220, h: 220, z, data: { text: "", color: "yellow" } }, true);
      } else if (gesture.tool === "text") {
        place({ id: newId(), type: "text", x: world.x, y: world.y - 20, w: 360, h: 48, z, data: { text: "", size: "m" } }, true);
      } else if (gesture.tool === "shape") {
        const rect = big ? dragged : { x: world.x - 100, y: world.y - 70, w: 200, h: 140 };
        place({ id: newId(), type: "shape", ...rect, z, data: { shape: shapeKind, color: "blue", text: "" } });
      } else if (gesture.tool === "frame") {
        const frames = [...items.values()].filter((item) => item.type === "frame").length;
        const rect = big ? dragged : { x: world.x - 480, y: world.y - 300, w: 960, h: 600 };
        place({ id: newId(), type: "frame", ...rect, z: minZ() - 1, data: { title: `Frame ${frames + 1}` } });
      }
      return;
    }

    if (gesture.type === "connector") {
      setLinkDraft(null);
      const hit = itemAt(document.elementFromPoint(event.clientX, event.clientY));
      const to: Anchor = hit && hit.type !== "connector" ? { id: hit.id } : { x: world.x, y: world.y };
      const same = "id" in gesture.from && "id" in to && gesture.from.id === to.id;
      const tiny = !("id" in to) && Math.hypot(world.x - gesture.fromPoint.x, world.y - gesture.fromPoint.y) * cam.zoom < 8;
      if (same || tiny) return;
      place({ id: newId(), type: "connector", x: 0, y: 0, w: 0, h: 0, z: maxZ() + 1, data: { from: gesture.from, to, label: "" } });
    }
  };

  const startResize = (handle: Handle) => (event: ReactPointerEvent) => {
    if (!selectionBounds) return;
    event.stopPropagation();
    rootRef.current?.setPointerCapture(event.pointerId);
    const ids = selectedBoxes.map((item) => item.id);
    gestureRef.current = {
      type: "resize",
      handle,
      bounds: selectionBounds,
      origins: new Map(ids.map((id) => [id, { ...items.get(id)! }] as const)),
      keepAspect: selectedBoxes.some((item) => item.type === "image" || item.type === "video"),
    };
  };

  // Wheel: pinch / ⌘-scroll zooms, scrolling pans
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = root.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        setCam((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---------- Editing text ----------

  const finishEditing = (id: string, value: string) => {
    setEditingId(null);
    const item = store.getStored().get(id);
    if (!item) return;
    const key = item.type === "frame" ? "title" : "text";
    const current = (item.data as Record<string, unknown>)[key];
    // A new, empty text box disappears
    if (item.type === "text" && !value.trim()) {
      deleteIds([id]);
      return;
    }
    if (current !== value) store.commit([{ kind: "patch", id, set: { data: { [key]: value } } }]);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (readOnly) return;
    // The canvas holds the pointer during a press, so the
    // event's target is the canvas: look at what's there
    const hit = itemAt(document.elementFromPoint(event.clientX, event.clientY));
    if (hit && (hit.type === "sticky" || hit.type === "text" || hit.type === "shape" || hit.type === "frame")) {
      setSelected(new Set([hit.id]));
      setEditingId(hit.id);
      return;
    }
    if (!hit && tool === "select") {
      // Double-click on empty canvas: a sticky note there
      const world = toWorld(event.clientX, event.clientY);
      place({ id: newId(), type: "sticky", x: world.x - 110, y: world.y - 110, w: 220, h: 220, z: maxZ() + 1, data: { text: "", color: "yellow" } }, true);
    }
  };

  // ---------- Selection actions ----------

  const patchSelected = (set: (item: BoardItem) => ItemPatch | null) => {
    const ops: BoardOp[] = [];
    for (const item of selectedItems) {
      const patch = set(item);
      if (patch) ops.push({ kind: "patch", id: item.id, set: patch });
    }
    store.commit(ops);
  };

  const duplicate = useCallback(
    (source: BoardItem[], offset = 24) => {
      if (!source.length) return;
      const ids = new Map(source.map((item) => [item.id, newId()]));
      let z = Math.max(0, ...[...store.getStored().values()].map((item) => item.z));
      const copies: BoardItem[] = source.map((item) => {
        const copy = { ...item, id: ids.get(item.id)!, x: item.x + offset, y: item.y + offset, z: ++z } as BoardItem;
        if (copy.type === "connector") {
          const remap = (anchor: Anchor): Anchor =>
            "id" in anchor ? (ids.has(anchor.id) ? { id: ids.get(anchor.id)! } : anchor) : { x: anchor.x + offset, y: anchor.y + offset };
          copy.data = { ...copy.data, from: remap(copy.data.from), to: remap(copy.data.to) };
        }
        return copy;
      });
      store.commit(copies.map((item) => ({ kind: "put", item })));
      setSelected(new Set(copies.map((item) => item.id)));
    },
    [store]
  );

  const reorder = (front: boolean) => {
    let z = front ? maxZ() : minZ();
    const ordered = [...selectedItems].sort((a, b) => (front ? a.z - b.z : b.z - a.z));
    store.commit(ordered.map((item) => ({ kind: "patch", id: item.id, set: { z: front ? ++z : --z } })));
  };

  // ---------- Media ----------

  const measure = (url: string, contentType: string) =>
    new Promise<{ w: number; h: number }>((resolve) => {
      if (contentType.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve({ w: video.videoWidth || 1280, h: video.videoHeight || 720 });
        video.onerror = () => resolve({ w: 1280, h: 720 });
        video.src = url;
      } else {
        const image = new Image();
        image.onload = () => resolve({ w: image.naturalWidth || 800, h: image.naturalHeight || 800 });
        image.onerror = () => resolve({ w: 800, h: 800 });
        image.src = url;
      }
    });

  // Library files (by URL) or web addresses ({ remote })
  const addMedia = useCallback(
    async (sourceUrls: (string | { remote: string })[], at?: Point) => {
      if (!sourceUrls.length) return;
      setAdding((count) => count + sourceUrls.length);
      setNotice("");
      const view = viewportWorld();
      const origin = at ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      const placed: BoardItem[] = [];
      const columns = Math.ceil(Math.sqrt(sourceUrls.length));
      const cell = 440;
      let z = Math.max(0, ...[...store.getStored().values()].map((item) => item.z));
      await Promise.all(
        sourceUrls.map(async (sourceUrl, index) => {
          try {
            const asset = typeof sourceUrl === "string" ? await addBoardAsset(board.id, sourceUrl) : await addRemoteBoardAsset(board.id, sourceUrl.remote);
            const size = await measure(asset.url, asset.contentType);
            const scale = Math.min(1, 400 / Math.max(size.w, size.h));
            const w = Math.round(size.w * scale);
            const h = Math.round(size.h * scale);
            const col = index % columns;
            const row = Math.floor(index / columns);
            placed[index] = {
              id: newId(),
              type: asset.contentType.startsWith("video/") ? "video" : "image",
              x: origin.x - (columns * cell) / 2 + col * cell + (cell - w) / 2,
              y: origin.y - (Math.ceil(sourceUrls.length / columns) * cell) / 2 + row * cell + (cell - h) / 2,
              w,
              h,
              z: ++z,
              data: { url: asset.url, name: asset.name, contentType: asset.contentType },
            } as BoardItem;
          } catch (error) {
            setNotice(errorMessage(error, "Couldn't add a file."));
          } finally {
            setAdding((count) => count - 1);
          }
        })
      );
      const ok = placed.filter(Boolean);
      if (ok.length) {
        store.commit(ok.map((item) => ({ kind: "put", item })));
        setSelected(new Set(ok.map((item) => item.id)));
      }
    },
    [board.id, store, viewportWorld]
  );

  const uploadAndAdd = useCallback(
    async (files: File[], at?: Point) => {
      const media = files.filter((file) => /^(image|video)\//.test(file.type));
      if (!media.length) return;
      setAdding((count) => count + media.length);
      try {
        const urls = (await Promise.all(media.map((file) => uploadToLibrary(file).catch(() => null)))).filter((url): url is string => Boolean(url));
        if (urls.length < media.length) setNotice("Some files couldn't be uploaded.");
        await addMedia(urls, at);
      } finally {
        setAdding((count) => count - media.length);
      }
    },
    [addMedia]
  );

  // Text pasted or dropped: a text item where it lands
  const addText = useCallback(
    (text: string, at?: Point) => {
      const clean = text.trim().slice(0, 5000);
      if (!clean) return;
      const view = viewportWorld();
      const origin = at ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      const lines = clean.split("\n").length;
      const longest = Math.max(...clean.split("\n").map((line) => line.length));
      const w = Math.min(640, Math.max(160, longest * 13));
      const h = Math.min(2000, Math.max(48, Math.ceil((longest * 13) / w) * lines * 30 + 18));
      const item: BoardItem = {
        id: newId(),
        type: "text",
        x: origin.x - w / 2,
        y: origin.y - h / 2,
        w,
        h,
        z: Math.max(0, ...[...store.getStored().values()].map((entry) => entry.z)) + 1,
        data: { text: clean, size: "m" },
      };
      store.commit([{ kind: "put", item }]);
      setSelected(new Set([item.id]));
    },
    [store, viewportWorld]
  );

  // What another website (or app) put on the clipboard or
  // in a drag: files, pictures in a bit of the page, a
  // link, or text
  const addFromTransfer = useCallback(
    async (data: DataTransfer, at?: Point) => {
      const files = [...data.files].filter((file) => /^(image|video)\//.test(file.type));
      if (files.length) return uploadAndAdd(files, at);

      const html = data.getData("text/html");
      const uriList = data.getData("text/uri-list");
      const text = data.getData("text/plain");

      // Pictures inside a copied bit of a web page
      if (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const sources = [...doc.querySelectorAll("img[src], video[src], video source[src]")]
          .map((element) => element.getAttribute("src") ?? "")
          .filter(Boolean)
          .slice(0, 12);
        if (sources.length) {
          const dataUrls = sources.filter((src) => src.startsWith("data:"));
          const remote = sources.filter((src) => /^https?:\/\//i.test(src));
          if (dataUrls.length) {
            const blobs = await Promise.all(dataUrls.map((src) => fetch(src).then((response) => response.blob()).catch(() => null)));
            const asFiles = blobs.flatMap((blob, index) => (blob && /^(image|video)\//.test(blob.type) ? [new File([blob], `pasted-${index + 1}.${blob.type.split("/")[1]}`, { type: blob.type })] : []));
            if (asFiles.length) await uploadAndAdd(asFiles, at);
          }
          if (remote.length) await addMedia(remote.map((url) => ({ remote: url })), at);
          if (dataUrls.length || remote.length) return;
        }
      }

      // A link: a picture or video if it is one, else the link as text
      const link = (uriList.split("\n").find((line) => line && !line.startsWith("#")) || text).trim();
      if (/^https?:\/\/\S+$/i.test(link)) {
        setAdding((count) => count + 1);
        try {
          await addMediaOrText(link, at);
        } finally {
          setAdding((count) => count - 1);
        }
        return;
      }

      if (text.trim()) addText(text, at);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadAndAdd, addMedia, addText]
  );

  // A pasted address: the picture or video at it, or (if
  // it's a web page) the link as text
  const addMediaOrText = async (link: string, at?: Point) => {
    try {
      await addRemoteBoardAsset(board.id, link);
    } catch {
      addText(link, at);
      return;
    }
    // Saved once; this places it (the same address isn't downloaded twice)
    await addMedia([{ remote: link }], at);
  };


  // Where a paste lands: under the mouse, or (with the
  // mouse off the canvas) the middle of the view, each
  // paste a little lower so they don't pile up
  const pastePoint = (): Point => {
    if (lastPointerRef.current) return lastPointerRef.current;
    const view = viewportWorld();
    const step = (pasteCountRef.current++ % 8) * 48;
    return { x: view.x + view.w / 2 + step, y: view.y + view.h / 2 + step };
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (readOnly) return;
    void addFromTransfer(event.dataTransfer, toWorld(event.clientX, event.clientY));
  };

  // ---------- Keyboard ----------

  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
    };
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || mediaKind || document.querySelector("[role=dialog]")) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const viewing = key === " " || (event.shiftKey && (event.code === "Digit1" || event.code === "Digit2")) || (mod && ["=", "+", "-", "0"].includes(key));
      if (readOnly && !viewing) {
        // Not the page's own select-all either
        if (mod && key === "a") event.preventDefault();
        return;
      }

      if (key === " " && !spaceDown) {
        event.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setSelected(new Set([...store.getStored().keys()]));
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        duplicate(selectedItems);
        return;
      }
      if (mod && key === "c" && selectedItems.length) {
        // The system clipboard says "these board items", so a
        // later copy elsewhere (another website) wins
        clipboardRef.current = selectedItems;
        clipboardMarkRef.current = `naar-board-items:${newId()}`;
        void navigator.clipboard?.writeText(clipboardMarkRef.current).catch(() => undefined);
        event.preventDefault();
        return;
      }
      if ((key === "backspace" || key === "delete") && selected.size) {
        event.preventDefault();
        deleteIds([...selected]);
        return;
      }
      if (key === "escape") {
        setSelected(new Set());
        setTool("select");
        return;
      }
      if (key === "enter" && selected.size === 1) {
        const only = selectedItems[0];
        if (only && ["sticky", "text", "shape", "frame"].includes(only.type)) {
          event.preventDefault();
          setEditingId(only.id);
        }
        return;
      }
      if (key.startsWith("arrow") && selectedBoxes.length) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        store.commit(withContents(selectedBoxes.map((item) => item.id)).map((id) => {
          const item = store.getStored().get(id)!;
          return { kind: "patch", id, set: { x: item.x + dx, y: item.y + dy } };
        }));
        return;
      }
      if (event.shiftKey && (event.code === "Digit1" || event.code === "Digit2")) {
        event.preventDefault();
        if (event.code === "Digit1") zoomTo(boundsOf([...store.getStored().values()].filter((item) => item.type !== "connector")), 1);
        else zoomTo(selectionBounds, 2);
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        zoomAt(1.2);
        return;
      }
      if (mod && key === "-") {
        event.preventDefault();
        zoomAt(1 / 1.2);
        return;
      }
      if (mod && key === "0") {
        event.preventDefault();
        setCam((current) => ({ ...current, zoom: 1 }));
        return;
      }
      if (key === "]" && selected.size) return reorder(true);
      if (key === "[" && selected.size) return reorder(false);
      if (mod || event.altKey) return;
      const shortcuts: Record<string, Tool> = { v: "select", h: "hand", s: "sticky", t: "text", r: "shape", o: "shape", l: "connector", f: "frame" };
      if (shortcuts[key]) {
        if (key === "r") setShapeKind("rect");
        if (key === "o") setShapeKind("ellipse");
        setTool(shortcuts[key]);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceDown(false);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (readOnly || typing(event.target) || mediaKind || document.querySelector("[role=dialog]")) return;
      const data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      // Board items copied here (⌘C)
      const text = data.getData("text/plain");
      if (clipboardRef.current.length && (text === clipboardMarkRef.current || (!text && !data.files.length && !data.getData("text/html")))) {
        duplicate(clipboardRef.current.map((item) => store.getStored().get(item.id) ?? item), 40);
        return;
      }
      void addFromTransfer(data, pastePoint());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  });

  // ---------- Rendering ----------

  const view = { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, w: size.w / cam.zoom, h: size.h / cam.zoom };
  const margin = { x: view.x - view.w * 0.5, y: view.y - view.h * 0.5, w: view.w * 2, h: view.h * 2 };
  const ordered = useMemo(() => [...items.values()].sort((a, b) => a.z - b.z), [items]);
  const frames = ordered.filter((item) => item.type === "frame");
  const visible = ordered.filter((item) => item.type !== "frame" && item.type !== "connector" && (intersects(item, margin) || selected.has(item.id)));
  const visibleFrames = frames.filter((item) => intersects(item, margin) || selected.has(item.id));
  const connectors = ordered.filter((item): item is Extract<BoardItem, { type: "connector" }> => item.type === "connector");
  const frameNumbers = new Map(
    [...frames].sort((a, b) => a.y - b.y || a.x - b.x).map((frame, index) => [frame.id, index + 1])
  );

  const cursor = readOnly || spaceDown || tool === "hand" ? (panning ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  const box = selectionBounds && { ...toScreen(selectionBounds), w: selectionBounds.w * cam.zoom, h: selectionBounds.h * cam.zoom };
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const handles: Handle[] = selectedBoxes.length === 1 ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : ["nw", "ne", "se", "sw"];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--board-bg)] text-fg">
      <TopBar
        name={name}
        onRename={async (next) => {
          const clean = next.trim();
          if (!clean || clean === savedNameRef.current) {
            setName(savedNameRef.current);
            return;
          }
          setName(clean);
          try {
            await renameBoard(board.id, clean);
            savedNameRef.current = clean;
          } catch (error) {
            setName(savedNameRef.current);
            setNotice(errorMessage(error, "Couldn't rename the board."));
          }
        }}
        store={store}
        readOnly={readOnly}
        ownerName={board.ownerName}
      />

      <div
        ref={rootRef}
        role="application"
        aria-label={`Board ${name}`}
        className="relative flex-1 touch-none overflow-hidden select-none"
        style={{
          cursor,
          backgroundImage: `radial-gradient(var(--board-dot) ${Math.max(1, cam.zoom * 1.2)}px, transparent 0)`,
          backgroundSize: `${GRID * cam.zoom}px ${GRID * cam.zoom}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={forgetPointer}
        onDoubleClick={onDoubleClick}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onContextMenu={(event) => event.preventDefault()}
      >
        {/* The world: everything in canvas units */}
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
          {visibleFrames.map((item) => (
            <ItemView key={item.id} item={item} editing={false} onEditDone={() => undefined} />
          ))}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
            <defs>
              <marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--board-connector)" />
              </marker>
              <marker id="board-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--board-select)" />
              </marker>
            </defs>
            {connectors.map((item) => {
              const ends = connectorEnds(item, items);
              if (!ends) return null;
              const [a, b] = ends;
              const isSelected = selected.has(item.id);
              return (
                <g key={item.id}>
                  <line data-item-id={item.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={16 / cam.zoom} className="pointer-events-auto cursor-pointer" />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={isSelected ? "var(--board-select)" : "var(--board-connector)"}
                    strokeWidth={2 / Math.min(1, cam.zoom)}
                    markerEnd={`url(#${isSelected ? "board-arrow-selected" : "board-arrow"})`}
                  />
                </g>
              );
            })}
            {linkDraft && (
              <line x1={linkDraft[0].x} y1={linkDraft[0].y} x2={linkDraft[1].x} y2={linkDraft[1].y} stroke="var(--board-select)" strokeWidth={2 / cam.zoom} strokeDasharray={`${6 / cam.zoom} ${4 / cam.zoom}`} markerEnd="url(#board-arrow-selected)" />
            )}
          </svg>
          {visible.map((item) => (
            <ItemView key={item.id} item={item} editing={editingId === item.id} onEditDone={(value) => finishEditing(item.id, value)} />
          ))}
          {createDraft && (
            <div
              className={cx("pointer-events-none absolute border-2 border-[var(--board-select)]", tool === "shape" && shapeKind === "ellipse" && "rounded-full")}
              style={{ left: createDraft.x, top: createDraft.y, width: createDraft.w, height: createDraft.h }}
            />
          )}
        </div>

        {/* Frame titles: above everything, always readable;
            click to select the frame, double-click to rename */}
        {visibleFrames.map((frame) => {
          if (frame.type !== "frame") return null;
          const at = toScreen(frame);
          return (
            <div
              key={frame.id}
              data-item-id={frame.id}
              className={cx(
                "absolute flex max-w-[60vw] -translate-y-full items-center gap-1.5 truncate pb-1 text-[12px] font-medium leading-4",
                selected.has(frame.id) ? "text-[var(--board-select)]" : "text-[var(--board-frame-title)] hover:text-fg"
              )}
              style={{ left: at.x, top: at.y, maxWidth: Math.max(80, frame.w * cam.zoom) }}
            >
              <span className="tabular-nums opacity-60">{frameNumbers.get(frame.id)}</span>
              {editingId === frame.id ? (
                <EditText value={frame.data.title} onDone={(value) => finishEditing(frame.id, value)} className="min-w-40 text-[12px] text-fg" single />
              ) : (
                <span className="truncate">{frame.data.title || "Frame"}</span>
              )}
            </div>
          );
        })}

        {/* Screen-space overlays: outlines, handles, guides */}
        {selectedBoxes.map((item) => {
          const at = toScreen(item);
          return (
            <div
              key={item.id}
              className="pointer-events-none absolute rounded-[2px] outline outline-2 outline-[var(--board-select)]"
              style={{ left: at.x, top: at.y, width: item.w * cam.zoom, height: item.h * cam.zoom }}
            />
          );
        })}
        {box && !editingId && (
          <>
            {selectedBoxes.length > 1 && (
              <div className="pointer-events-none absolute outline outline-1 outline-dashed outline-[var(--board-select)]" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
            )}
            {handles.map((handle) => (
              <span
                key={handle}
                onPointerDown={startResize(handle)}
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[var(--board-select)] bg-white shadow"
                style={{
                  left: box.x + (handle.includes("w") ? 0 : handle.includes("e") ? box.w : box.w / 2),
                  top: box.y + (handle.includes("n") ? 0 : handle.includes("s") ? box.h : box.h / 2),
                  cursor: `${handle}-resize`,
                }}
              />
            ))}
            <ContextBar
              at={{ x: box.x + box.w / 2, y: box.y }}
              items={selectedItems}
              single={single}
              onColor={(color) => patchSelected((item) => (item.type === "sticky" || item.type === "shape" ? { data: { color } } : null))}
              onShape={(shape) => patchSelected((item) => (item.type === "shape" ? { data: { shape } } : null))}
              onSize={(size) => patchSelected((item) => (item.type === "text" ? { data: { size } } : null))}
              onDuplicate={() => duplicate(selectedItems)}
              onFront={() => reorder(true)}
              onBack={() => reorder(false)}
              onDelete={() => deleteIds([...selected])}
            />
          </>
        )}
        {marquee && (
          <div
            className="pointer-events-none absolute border border-[var(--board-select)] bg-[var(--board-select)]/10"
            style={{ left: marquee.x * cam.zoom + cam.x, top: marquee.y * cam.zoom + cam.y, width: marquee.w * cam.zoom, height: marquee.h * cam.zoom }}
          />
        )}
        {guides.map((guide, index) =>
          guide.axis === "x" ? (
            <div key={index} className="pointer-events-none absolute inset-y-0 w-px bg-[var(--board-guide)]" style={{ left: guide.at * cam.zoom + cam.x }} />
          ) : (
            <div key={index} className="pointer-events-none absolute inset-x-0 h-px bg-[var(--board-guide)]" style={{ top: guide.at * cam.zoom + cam.y }} />
          )
        )}

        {items.size === 0 && !adding && !readOnly && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm text-center">
              <p className="text-lg font-semibold text-fg">Start your board</p>
              <p className="mt-1 text-sm text-fg-muted">
                Add pictures and videos from History, your library or elements, drop files here, or double-click for a sticky note.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom: zoom, tools */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[41] flex items-end justify-between px-4">
        <div className="pointer-events-auto glass flex items-center gap-0.5 rounded-xl p-1 text-xs shadow-lg">
          <IconButton icon="minus" label="Zoom out (⌘−)" onClick={() => zoomAt(1 / 1.2)} />
          <button type="button" onClick={() => zoomTo(boundsOf([...items.values()].filter((item) => item.type !== "connector")), 1)} className="min-w-14 rounded-lg px-2 py-1.5 font-mono tabular-nums text-fg-muted hover:bg-raised hover:text-fg" title="Zoom to fit (⇧1)">
            {Math.round(cam.zoom * 100)}%
          </button>
          <IconButton icon="plus" label="Zoom in (⌘+)" onClick={() => zoomAt(1.2)} />
        </div>

        {readOnly ? (
          <div className="pointer-events-auto glass rounded-2xl px-4 py-2.5 text-xs text-fg-muted shadow-xl">Drag to look around · pinch or ⌘-scroll to zoom</div>
        ) : (
        <div className="pointer-events-auto glass relative flex items-center gap-1 rounded-2xl p-1.5 shadow-xl">
          {TOOLS.map((item) => (
            <IconButton
              key={item.tool}
              icon={item.tool === "shape" ? (shapeKind === "ellipse" ? "circle" : shapeKind === "diamond" ? "diamond" : "square") : item.icon}
              label={`${item.label} (${item.key})`}
              active={tool === item.tool}
              size="lg"
              onClick={() => setTool(item.tool)}
            />
          ))}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <div className="relative">
            <IconButton icon="image" label="Add pictures or videos" size="lg" active={mediaMenu} onClick={() => setMediaMenu((open) => !open)} />
            {mediaMenu && (
              <div className="glass-menu absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 rounded-xl border border-line p-1 shadow-xl" role="menu">
                {(["image", "video"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMediaMenu(false);
                      setMediaKind(kind);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-raised"
                  >
                    <Icon name={kind} size={15} />
                    {kind === "image" ? "Pictures" : "Videos"}
                    <span className="ml-auto text-[11px] text-fg-subtle">History · library</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {tool === "shape" && (
            <div className="glass absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-xl p-1 shadow-lg">
              {(["rect", "ellipse", "diamond"] as const).map((kind) => (
                <IconButton key={kind} icon={kind === "rect" ? "square" : kind === "ellipse" ? "circle" : "diamond"} label={kind === "rect" ? "Rectangle" : kind === "ellipse" ? "Ellipse" : "Diamond"} active={shapeKind === kind} onClick={() => setShapeKind(kind)} />
              ))}
            </div>
          )}
        </div>
        )}

        <div className="w-[118px]" aria-hidden />
      </div>

      {(adding > 0 || notice) && (
        <div className="fixed left-1/2 top-16 z-[41] -translate-x-1/2">
          <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-lg" role="status">
            {adding > 0 ? (
              <>
                <Spinner /> Adding {adding} file{adding === 1 ? "" : "s"}…
              </>
            ) : (
              <>
                <Icon name="alert" size={14} className="text-danger" />
                {notice}
                <button type="button" onClick={() => setNotice("")} className="ml-1 text-fg-subtle hover:text-fg" aria-label="Dismiss">
                  <Icon name="close" size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {mediaKind && (
        <MediaLibraryDialog
          kind={mediaKind}
          multiple
          title={mediaKind === "image" ? "Add pictures to the board" : "Add videos to the board"}
          inField={[]}
          onUpload={(files) => {
            setMediaKind(null);
            void uploadAndAdd(files);
          }}
          onPick={(urls) => {
            setMediaKind(null);
            void addMedia(urls);
          }}
          onClose={() => setMediaKind(null)}
        />
      )}
    </div>
  );
}

// --------------------------------------------------
// PIECES
// --------------------------------------------------

function TopBar({
  name,
  onRename,
  store,
  readOnly,
  ownerName,
}: {
  name: string;
  onRename: (name: string) => void;
  store: BoardStore;
  readOnly: boolean;
  ownerName: string;
}) {
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  return (
    <header className="z-[41] flex h-14 shrink-0 items-center gap-3 border-b border-line bg-[var(--board-bg)]/90 px-3 backdrop-blur">
      <Link href="/boards" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-fg-muted hover:bg-raised hover:text-fg">
        <Icon name="chevronLeft" size={16} />
        Boards
      </Link>
      <span className="h-5 w-px bg-line" aria-hidden />
      {readOnly ? (
        <p className="max-w-[40vw] truncate px-2 text-sm font-semibold text-fg">{name}</p>
      ) : editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            onRename(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          aria-label="Board name"
          className="h-8 w-72 rounded-lg border border-line bg-sunken px-2 text-sm font-semibold text-fg outline-none focus:border-accent"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="max-w-[40vw] truncate rounded-lg px-2 py-1 text-sm font-semibold text-fg hover:bg-raised"
          title="Rename"
        >
          {name}
        </button>
      )}

      {readOnly ? (
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-sunken px-3 py-1 text-xs text-fg-muted" title="You're seeing another user's board. Only its owner can change it.">
          <Icon name="eye" size={13} />
          View only · <span className="font-medium text-fg">{ownerName}</span>&rsquo;s board
        </span>
      ) : (
      <div className="ml-auto flex items-center gap-1">
        <span
          className={cx("mr-2 flex items-center gap-1.5 text-xs", store.saveState === "retrying" ? "text-danger" : "text-fg-subtle")}
          role="status"
          title={store.saveError || undefined}
        >
          {store.saveState === "saved" ? (
            <>
              <Icon name="check" size={12} /> Saved
            </>
          ) : store.saveState === "saving" ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            <>
              <Icon name="alert" size={12} /> Not saved, retrying
            </>
          )}
        </span>
        <IconButton icon="undo" label="Undo (⌘Z)" onClick={store.undo} disabled={!store.canUndo} />
        <IconButton icon="redo" label="Redo (⇧⌘Z)" onClick={store.redo} disabled={!store.canRedo} />
      </div>
      )}
    </header>
  );
}

function ContextBar({
  at,
  items,
  single,
  onColor,
  onShape,
  onSize,
  onDuplicate,
  onFront,
  onBack,
  onDelete,
}: {
  at: Point;
  items: BoardItem[];
  single: BoardItem | null;
  onColor: (color: StickyColor) => void;
  onShape: (shape: ShapeKind) => void;
  onSize: (size: TextSize) => void;
  onDuplicate: () => void;
  onFront: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const colorable = items.some((item) => item.type === "sticky" || item.type === "shape");
  const shapes = items.every((item) => item.type === "shape");
  const texts = items.every((item) => item.type === "text");
  const media = single && (single.type === "image" || single.type === "video") ? single : null;
  return (
    <div
      className="glass absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-xl p-1 shadow-lg"
      style={{ left: at.x, top: at.y - 14 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {colorable &&
        STICKY_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onColor(color)}
            title={COLORS[color].label}
            aria-label={COLORS[color].label}
            className="m-0.5 h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110"
            style={{ background: COLORS[color].fill }}
          />
        ))}
      {shapes && (
        <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {(["rect", "ellipse", "diamond"] as const).map((kind) => (
            <IconButton key={kind} icon={kind === "rect" ? "square" : kind === "ellipse" ? "circle" : "diamond"} label={kind} onClick={() => onShape(kind)} />
          ))}
        </>
      )}
      {texts &&
        TEXT_SIZES.map((size) => (
          <button key={size} type="button" onClick={() => onSize(size)} className="rounded-lg px-2 py-1 text-xs font-semibold uppercase text-fg-muted hover:bg-raised hover:text-fg">
            {size}
          </button>
        ))}
      {(colorable || texts) && <span className="mx-1 h-5 w-px bg-line" aria-hidden />}
      {media && (
        <a
          href={media.data.url}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-fg-muted hover:bg-raised hover:text-fg"
          title="Open full size"
        >
          <Icon name="eye" size={14} /> Open
        </a>
      )}
      <IconButton icon="copy" label="Duplicate (⌘D)" onClick={onDuplicate} />
      <IconButton icon="bringFront" label="Bring to front (])" onClick={onFront} />
      <IconButton icon="sendBack" label="Send to back ([)" onClick={onBack} />
      <IconButton icon="trash" label="Delete (⌫)" onClick={onDelete} danger />
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  danger,
  size = "md",
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        "flex items-center justify-center rounded-lg transition-colors disabled:opacity-35",
        size === "lg" ? "h-10 w-10" : "h-8 w-8",
        active ? "bg-accent text-on-accent" : danger ? "text-fg-muted hover:bg-danger/10 hover:text-danger" : "text-fg-muted hover:bg-raised hover:text-fg"
      )}
    >
      <Icon name={icon} size={size === "lg" ? 19 : 16} />
    </button>
  );
}

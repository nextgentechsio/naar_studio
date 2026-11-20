"use client";

import { boundsOf, connectorEnds, type BoardItem, type ItemMap, type Rect } from "@/lib/boards/shared";
import { COLORS, PEN, strokePath, TEXT_PX } from "./ItemView";

// --------------------------------------------------
// A SELECTION AS A PNG (like FigJam's "Export as PNG")
//
// Redraws the items on a canvas at 2× (less for huge
// selections), on white with a margin. Pictures come
// through the board's own file route, so the canvas can
// be saved. Videos show as a dark frame with a label.
// --------------------------------------------------

const PADDING = 32;
const MAX_SIDE = 12_000;
const MAX_PIXELS = 80_000_000;

export const boardFileUrl = (boardId: string, url: string, download = false) =>
  `/api/boards/${encodeURIComponent(boardId)}/file?url=${encodeURIComponent(url)}${download ? "&download=1" : ""}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

// Words wrapped to a width; long words are broken
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (ctx.measureText(next).width <= width || !line.trim()) {
        if (ctx.measureText(next).width <= width) {
          line = next;
          continue;
        }
        // One word wider than the box: break it
        let piece = "";
        for (const char of next) {
          if (ctx.measureText(piece + char).width > width && piece) {
            lines.push(piece);
            piece = char;
          } else piece += char;
        }
        line = piece;
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Rect,
  options: { size: number; weight: number; color: string; align?: "left" | "center"; lineHeight?: number; middle?: boolean }
) {
  const font = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  ctx.font = `${options.weight} ${options.size}px ${font}`;
  ctx.fillStyle = options.color;
  ctx.textBaseline = "top";
  ctx.textAlign = options.align ?? "left";
  const lineHeight = options.size * (options.lineHeight ?? 1.3);
  const lines = wrap(ctx, text, box.w);
  const maxLines = Math.max(1, Math.floor(box.h / lineHeight));
  const shown = lines.slice(0, maxLines);
  const top = options.middle ? box.y + (box.h - shown.length * lineHeight) / 2 : box.y;
  const x = options.align === "center" ? box.x + box.w / 2 : box.x;
  shown.forEach((line, index) => ctx.fillText(line, x, top + index * lineHeight));
}

function roundRect(ctx: CanvasRenderingContext2D, rect: Rect, radius: number) {
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
}

// The items to draw for a selection: frames bring what's
// inside them; connectors between drawn items come along
export function exportItems(selection: BoardItem[], all: ItemMap): BoardItem[] {
  const ids = new Set(selection.map((item) => item.id));
  for (const item of selection) {
    if (item.type !== "frame") continue;
    for (const other of all.values()) {
      if (other.type !== "connector" && other.id !== item.id && other.x >= item.x && other.y >= item.y && other.x + other.w <= item.x + item.w && other.y + other.h <= item.y + item.h) {
        ids.add(other.id);
      }
    }
  }
  for (const other of all.values()) {
    if (other.type !== "connector") continue;
    const ends = [other.data.from, other.data.to];
    if (ends.every((end) => !("id" in end) || ids.has(end.id)) && ends.some((end) => "id" in end)) ids.add(other.id);
  }
  return [...ids].map((id) => all.get(id)).filter((item): item is BoardItem => Boolean(item));
}

export type ExportOptions = {
  // 1×, 2× (default) or 4× the board's size
  scale?: number;
  // PNG keeps it; JPG is always on white
  transparent?: boolean;
  type?: "image/png" | "image/jpeg";
};

export async function selectionToPng(boardId: string, selection: BoardItem[], all: ItemMap, options: ExportOptions = {}): Promise<Blob> {
  const type = options.type ?? "image/png";
  const transparent = type === "image/png" && Boolean(options.transparent);
  const items = exportItems(selection, all);
  const boxes = items.filter((item) => item.type !== "connector");
  // Connectors with free ends widen the picture too
  const points: Rect[] = [];
  for (const item of items) {
    if (item.type !== "connector") continue;
    const ends = connectorEnds(item, all);
    if (ends) ends.forEach((point) => points.push({ x: point.x, y: point.y, w: 0, h: 0 }));
  }
  const bounds = boundsOf([...boxes, ...points]);
  if (!bounds) throw new Error("Nothing to export");

  const width = bounds.w + PADDING * 2;
  const height = bounds.h + PADDING * 2;
  let scale = options.scale ?? 2;
  scale = Math.min(scale, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  scale = Math.max(0.1, scale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the export");
  ctx.scale(scale, scale);
  if (!transparent) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.translate(PADDING - bounds.x, PADDING - bounds.y);

  // Pictures first, all at once
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    items
      .filter((item) => item.type === "image")
      .map(async (item) => {
        if (item.type === "image") images.set(item.id, await loadImage(boardFileUrl(boardId, item.data.url)));
      })
  );

  const ordered = [...items].sort((a, b) => (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0) || a.z - b.z);
  const frames = ordered.filter((item) => item.type === "frame");
  const connectors = ordered.filter((item) => item.type === "connector");
  const rest = ordered.filter((item) => item.type !== "frame" && item.type !== "connector");

  for (const item of frames) {
    if (item.type !== "frame") continue;
    roundRect(ctx, item, 6);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(13,13,13,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawText(ctx, item.data.title || "Frame", { x: item.x, y: item.y - 22, w: item.w, h: 20 }, { size: 14, weight: 500, color: "rgba(13,13,13,0.6)" });
  }

  for (const item of connectors) {
    if (item.type !== "connector") continue;
    const ends = connectorEnds(item, all);
    if (!ends) continue;
    const [a, b] = ends;
    ctx.strokeStyle = "#3d3d3d";
    ctx.fillStyle = "#3d3d3d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 12 * Math.cos(angle - 0.45), b.y - 12 * Math.sin(angle - 0.45));
    ctx.lineTo(b.x - 12 * Math.cos(angle + 0.45), b.y - 12 * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  for (const item of rest) {
    if (item.type === "sticky") {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = COLORS[item.data.color].fill;
      roundRect(ctx, item, 3);
      ctx.fill();
      ctx.restore();
      drawText(ctx, item.data.text, { x: item.x + 16, y: item.y + 16, w: item.w - 32, h: item.h - 32 }, { size: 18, weight: 400, color: "#1b1b1b", lineHeight: 1.35 });
    } else if (item.type === "text") {
      drawText(ctx, item.data.text, item, { size: TEXT_PX[item.data.size], weight: 600, color: "#141414", lineHeight: 1.2 });
    } else if (item.type === "shape") {
      const color = COLORS[item.data.color];
      ctx.beginPath();
      if (item.data.shape === "ellipse") ctx.ellipse(item.x + item.w / 2, item.y + item.h / 2, item.w / 2, item.h / 2, 0, 0, Math.PI * 2);
      else if (item.data.shape === "triangle") {
        ctx.moveTo(item.x + item.w / 2, item.y);
        ctx.lineTo(item.x + item.w, item.y + item.h);
        ctx.lineTo(item.x, item.y + item.h);
        ctx.closePath();
      } else if (item.data.shape === "diamond") {
        ctx.moveTo(item.x + item.w / 2, item.y);
        ctx.lineTo(item.x + item.w, item.y + item.h / 2);
        ctx.lineTo(item.x + item.w / 2, item.y + item.h);
        ctx.lineTo(item.x, item.y + item.h / 2);
        ctx.closePath();
      } else ctx.roundRect(item.x, item.y, item.w, item.h, 10);
      ctx.fillStyle = color.fill;
      ctx.fill();
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      drawText(ctx, item.data.text, { x: item.x + 16, y: item.y + 8, w: item.w - 32, h: item.h - 16 }, { size: 18, weight: 400, color: "#1b1b1b", align: "center", middle: true });
    } else if (item.type === "image") {
      const image = images.get(item.id);
      ctx.save();
      roundRect(ctx, item, 6);
      ctx.clip();
      if (image) {
        // object-fit: cover, as on the board
        const scaleToCover = Math.max(item.w / image.naturalWidth, item.h / image.naturalHeight);
        const sw = item.w / scaleToCover;
        const sh = item.h / scaleToCover;
        ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, item.x, item.y, item.w, item.h);
      } else {
        ctx.fillStyle = "#e5e5e5";
        ctx.fillRect(item.x, item.y, item.w, item.h);
      }
      ctx.restore();
    } else if (item.type === "draw") {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.scale(item.w / item.data.ow, item.h / item.data.oh);
      ctx.strokeStyle = PEN[item.data.color].stroke;
      // Width as on the board (not stretched with the box)
      ctx.lineWidth = item.data.width / Math.max(item.w / item.data.ow, item.h / item.data.oh, 0.01);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(strokePath(item.data.points)));
      ctx.restore();
    } else if (item.type === "video") {
      roundRect(ctx, item, 6);
      ctx.fillStyle = "#111111";
      ctx.fill();
      drawText(ctx, `▶ ${item.data.name || "Video"}`, { x: item.x + 16, y: item.y, w: item.w - 32, h: item.h }, { size: 18, weight: 500, color: "#ffffff", align: "center", middle: true });
    }
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make the image"))), type, type === "image/jpeg" ? 0.92 : undefined)
  );
}

// Saves a blob, or a same-address URL, as a file
export function saveFile(source: Blob | string, name: string) {
  const href = typeof source === "string" ? source : URL.createObjectURL(source);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof source !== "string") setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

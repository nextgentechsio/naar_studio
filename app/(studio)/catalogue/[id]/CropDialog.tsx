"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Crop } from "@/lib/catalogue/shared";
import { Modal } from "@/app/components/ui/Modal";
import { Button, cx, Spinner } from "@/app/components/ui/primitives";

// --------------------------------------------------
// CROP ONE VERSION
//
// A box over the image: drag it to move, drag a corner
// (or an edge, when the shape is free) to resize; arrow
// keys move it too. Shapes keep the box to a ratio. The
// full image is kept; the crop is what's shown and
// downloaded, and can be changed or reset later.
// --------------------------------------------------

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05;

// Width / height of the cropped picture; null: free
const SHAPES: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "3:4", ratio: 3 / 4 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "1:1", ratio: 1 },
  { label: "9:16", ratio: 9 / 16 },
];

type Edges = { l?: boolean; r?: boolean; t?: boolean; b?: boolean };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The largest box of a ratio, centred on a point
function fitShape(imageRatio: number, ratio: number, around: Crop): Crop {
  // In fractions, h = w * k
  const k = imageRatio / ratio;
  let w = 1;
  let h = k;
  if (h > 1) {
    h = 1;
    w = 1 / k;
  }
  const cx = around.x + around.w / 2;
  const cy = around.y + around.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

function resize(start: Crop, edges: Edges, dx: number, dy: number, k: number | null): Crop {
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (edges.l) left = clamp(left + dx, 0, right - MIN);
  if (edges.r) right = clamp(right + dx, left + MIN, 1);
  if (edges.t) top = clamp(top + dy, 0, bottom - MIN);
  if (edges.b) bottom = clamp(bottom + dy, top + MIN, 1);
  if (k === null) return { x: left, y: top, w: right - left, h: bottom - top };

  // Kept to the shape: the width leads, the height follows
  // from the corner opposite the one dragged
  const maxW = edges.l ? start.x + start.w : 1 - start.x;
  const maxH = edges.t ? start.y + start.h : 1 - start.y;
  const w = clamp(right - left, MIN, Math.min(maxW, maxH / k));
  const h = w * k;
  const x = edges.l ? start.x + start.w - w : start.x;
  const y = edges.t ? start.y + start.h - h : start.y;
  return { x, y, w, h };
}

export default function CropDialog({
  src,
  crop,
  imageRatio,
  onSave,
  onClose,
}: {
  src: string;
  crop: Crop | null;
  // Width / height of the full image
  imageRatio: number;
  // Resolves to an error message, or null when saved
  onSave: (crop: Crop | null) => Promise<string | null>;
  onClose: () => void;
}) {
  const [box, setBox] = useState<Crop>(crop ?? FULL);
  const [shape, setShape] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; start: Crop; edges: Edges | null } | null>(null);

  const ratio = natural ? natural.w / natural.h : imageRatio;
  const k = shape === null ? null : ratio / shape;

  function begin(event: ReactPointerEvent, edges: Edges | null) {
    if (saving) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: box, edges };
  }

  function move(event: ReactPointerEvent) {
    const current = drag.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!current || current.id !== event.pointerId || !rect) return;
    const dx = (event.clientX - current.x) / rect.width;
    const dy = (event.clientY - current.y) / rect.height;
    const { start, edges } = current;
    setBox(
      edges
        ? resize(start, edges, dx, dy, k)
        : { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) },
    );
  }

  function end(event: ReactPointerEvent) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function nudge(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    setBox((current) => ({
      ...current,
      x: clamp(current.x + delta[0], 0, 1 - current.w),
      y: clamp(current.y + delta[1], 0, 1 - current.h),
    }));
  }

  function pickShape(next: number | null) {
    setShape(next);
    if (next !== null) setBox((current) => fitShape(ratio, next, current));
  }

  async function save(close: () => void) {
    setSaving(true);
    setError("");
    const whole = box.w > 0.999 && box.h > 0.999;
    const failed = await onSave(whole ? null : box);
    setSaving(false);
    if (failed) setError(failed);
    else close();
  }

  const handles: { edges: Edges; className: string; cursor: string; edge?: boolean }[] = [
    { edges: { l: true, t: true }, className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
    { edges: { r: true, t: true }, className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
    { edges: { l: true, b: true }, className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
    { edges: { r: true, b: true }, className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
    { edges: { t: true }, className: "-top-1 left-1/2 -translate-x-1/2", cursor: "ns-resize", edge: true },
    { edges: { b: true }, className: "-bottom-1 left-1/2 -translate-x-1/2", cursor: "ns-resize", edge: true },
    { edges: { l: true }, className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize", edge: true },
    { edges: { r: true }, className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize", edge: true },
  ];
  const size = natural ? `${Math.round(box.w * natural.w)} × ${Math.round(box.h * natural.h)} px` : null;

  return (
    <Modal title="Crop" subtitle="Drag the box or its corners. The full image is kept, so you can change this later." size="xl" onClose={onClose}>
      {(close) => (
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-3 overflow-y-auto px-5 pb-4 pt-1">
            <div role="radiogroup" aria-label="Shape" className="flex flex-wrap items-center gap-1.5">
              {SHAPES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="radio"
                  aria-checked={shape === item.ratio}
                  onClick={() => pickShape(item.ratio)}
                  disabled={saving}
                  className={cx(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200",
                    shape === item.ratio
                      ? "border-accent bg-accent-soft text-fg"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {item.label}
                </button>
              ))}
              {size && <span className="ml-auto text-xs tabular-nums text-fg-subtle">{size}</span>}
            </div>

            <div className="flex justify-center rounded-xl bg-sunken p-3">
              <div
                ref={stage}
                className="relative touch-none select-none overflow-hidden rounded-md"
                style={{ aspectRatio: ratio, width: `min(100%, calc((100dvh - 25rem) * ${ratio}))` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="Image to crop"
                  draggable={false}
                  onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                />
                <div
                  role="group"
                  aria-roledescription="crop area"
                  tabIndex={0}
                  aria-label={`Crop area, ${Math.round(box.w * 100)}% by ${Math.round(box.h * 100)}% of the image. Arrow keys move it.`}
                  onKeyDown={nudge}
                  onPointerDown={(event) => begin(event, null)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute cursor-move outline-none ring-white/80 focus-visible:ring-2"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
                    border: "1.5px solid rgb(255 255 255 / 0.95)",
                  }}
                >
                  {/* Thirds */}
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />
                  {handles
                    .filter((handle) => !handle.edge || shape === null)
                    .map((handle) => (
                      <span
                        key={handle.className}
                        aria-hidden
                        onPointerDown={(event) => begin(event, handle.edges)}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                        style={{ cursor: handle.cursor }}
                        className={cx(
                          "absolute rounded-sm bg-white shadow-md",
                          handle.edge ? (handle.edges.t || handle.edges.b ? "h-2 w-6" : "h-6 w-2") : "h-3.5 w-3.5",
                          handle.className,
                        )}
                      />
                    ))}
                </div>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <Button
              variant="ghost"
              onClick={() => {
                setShape(null);
                setBox(FULL);
              }}
              disabled={saving}
            >
              Reset to full image
            </Button>
            <div className="flex gap-2">
              <Button onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" icon={saving ? undefined : "check"} disabled={saving} onClick={() => void save(close)}>
                {saving && <Spinner />}
                Save crop
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

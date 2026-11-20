"use client";

import { memo, useEffect, useRef } from "react";
import type { BoardItem, PenColor, StickyColor, TextSize } from "@/lib/boards/shared";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// ONE ITEM ON THE CANVAS (in canvas units: it's scaled
// with the whole world layer)
// --------------------------------------------------

// Pastel notes read the same in light and dark themes
export const COLORS: Record<StickyColor, { fill: string; stroke: string; label: string }> = {
  yellow: { fill: "#FFE48A", stroke: "#D9B630", label: "Yellow" },
  orange: { fill: "#FFC98F", stroke: "#E08A3A", label: "Orange" },
  pink: { fill: "#FFC1D3", stroke: "#E0638A", label: "Pink" },
  violet: { fill: "#D9CCFF", stroke: "#8B6CF0", label: "Violet" },
  blue: { fill: "#B9DCFF", stroke: "#3E8BE0", label: "Blue" },
  teal: { fill: "#A8EBE1", stroke: "#25A894", label: "Teal" },
  green: { fill: "#C5EBB1", stroke: "#56A93A", label: "Green" },
  gray: { fill: "#E6E6E6", stroke: "#9A9A9A", label: "Gray" },
};

export const TEXT_PX: Record<TextSize, number> = { s: 16, m: 24, l: 40, xl: 64 };

export const PEN: Record<PenColor, { stroke: string; label: string }> = {
  ink: { stroke: "#1b1b1b", label: "Black" },
  red: { stroke: "#E5484D", label: "Red" },
  blue: { stroke: "#2F7CF6", label: "Blue" },
  green: { stroke: "#2FA160", label: "Green" },
  violet: { stroke: "#8B5CF6", label: "Violet" },
  orange: { stroke: "#F2851F", label: "Orange" },
};

// A marker stroke as an SVG path (smoothed through the
// midpoints of the points it was drawn through)
export function strokePath(points: number[]): string {
  if (points.length < 4) return "";
  let d = `M${points[0]},${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2;
    const my = (points[i + 1] + points[i + 3]) / 2;
    d += ` Q${points[i]},${points[i + 1]} ${mx},${my}`;
  }
  d += ` L${points[points.length - 2]},${points[points.length - 1]}`;
  return d;
}

type Props = {
  item: BoardItem;
  editing: boolean;
  onEditDone: (text: string) => void;
};

function ItemView({ item, editing, onEditDone }: Props) {
  const style = { left: item.x, top: item.y, width: item.w, height: item.h } as const;

  if (item.type === "frame") {
    // Its title is drawn above everything, at screen size
    // (BoardEditor); the body lets you drag-select inside
    return (
      <div data-frame-body={item.id} className="pointer-events-none absolute" style={style}>
        <div className="absolute inset-0 rounded-md border border-[var(--board-frame-line)] bg-[var(--board-frame-fill)]" />
      </div>
    );
  }

  if (item.type === "sticky") {
    const color = COLORS[item.data.color];
    return (
      <div
        data-item-id={item.id}
        className="absolute flex flex-col rounded-[3px] p-4 text-[#1b1b1b] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_6px_16px_-6px_rgb(0_0_0/0.25)]"
        style={{ ...style, background: color.fill }}
      >
        {editing ? (
          <EditText value={item.data.text} onDone={onEditDone} className="h-full text-[18px] leading-snug" />
        ) : (
          <p className="h-full overflow-hidden whitespace-pre-wrap break-words text-[18px] leading-snug">{item.data.text}</p>
        )}
      </div>
    );
  }

  if (item.type === "text") {
    const size = TEXT_PX[item.data.size];
    return (
      <div data-item-id={item.id} className="absolute text-[var(--board-ink)]" style={style}>
        {editing ? (
          <EditText value={item.data.text} onDone={onEditDone} className="h-full font-semibold leading-tight" fontSize={size} />
        ) : (
          <p className="h-full overflow-hidden whitespace-pre-wrap break-words font-semibold leading-tight" style={{ fontSize: size }}>
            {item.data.text || <span className="opacity-40">Text</span>}
          </p>
        )}
      </div>
    );
  }

  if (item.type === "shape") {
    const color = COLORS[item.data.color];
    return (
      <div data-item-id={item.id} className="absolute flex items-center justify-center" style={style}>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${item.w} ${item.h}`} preserveAspectRatio="none" aria-hidden>
          {item.data.shape === "ellipse" ? (
            <ellipse cx={item.w / 2} cy={item.h / 2} rx={item.w / 2} ry={item.h / 2} fill={color.fill} stroke={color.stroke} strokeWidth={2} />
          ) : item.data.shape === "triangle" ? (
            <polygon points={`${item.w / 2},0 ${item.w},${item.h} 0,${item.h}`} fill={color.fill} stroke={color.stroke} strokeWidth={2} strokeLinejoin="round" />
          ) : item.data.shape === "diamond" ? (
            <polygon points={`${item.w / 2},0 ${item.w},${item.h / 2} ${item.w / 2},${item.h} 0,${item.h / 2}`} fill={color.fill} stroke={color.stroke} strokeWidth={2} />
          ) : (
            <rect x={0} y={0} width={item.w} height={item.h} rx={10} fill={color.fill} stroke={color.stroke} strokeWidth={2} />
          )}
        </svg>
        <div className="relative w-full px-4 text-center text-[18px] leading-snug text-[#1b1b1b]">
          {editing ? (
            <EditText value={item.data.text} onDone={onEditDone} className="text-center" />
          ) : (
            <p className="whitespace-pre-wrap break-words">{item.data.text}</p>
          )}
        </div>
      </div>
    );
  }

  if (item.type === "draw") {
    return (
      <div data-item-id={item.id} className="absolute" style={style}>
        <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${item.data.ow} ${item.data.oh}`} preserveAspectRatio="none" aria-hidden>
          <path
            d={strokePath(item.data.points)}
            fill="none"
            stroke={PEN[item.data.color].stroke}
            strokeWidth={item.data.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    );
  }

  if (item.type === "image") {
    return (
      <div data-item-id={item.id} className="absolute overflow-hidden rounded-md bg-black/5 shadow-[0_1px_2px_rgb(0_0_0/0.15)]" style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.data.url} alt={item.data.name} draggable={false} loading="lazy" className="h-full w-full select-none object-cover" />
      </div>
    );
  }

  if (item.type === "video") {
    return (
      <div data-item-id={item.id} className="absolute overflow-hidden rounded-md bg-black shadow-[0_1px_2px_rgb(0_0_0/0.15)]" style={style}>
        <video
          src={item.data.url}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onPointerEnter={(event) => void event.currentTarget.play().catch(() => undefined)}
          onPointerLeave={(event) => event.currentTarget.pause()}
        />
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[12px] font-medium text-white">Video</span>
      </div>
    );
  }

  return null;
}

export default memo(ItemView);

// Text typed into an item; done on blur or Escape
export function EditText({
  value,
  onDone,
  className,
  fontSize,
  single,
}: {
  value: string;
  onDone: (text: string) => void;
  className?: string;
  fontSize?: number;
  single?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus();
    area.select();
  }, []);
  return (
    <textarea
      ref={ref}
      defaultValue={value}
      rows={single ? 1 : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => onDone(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || (single && event.key === "Enter") || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className={cx("block w-full resize-none border-0 bg-transparent p-0 outline-none", className)}
      style={fontSize ? { fontSize } : undefined}
      aria-label="Edit text"
    />
  );
}

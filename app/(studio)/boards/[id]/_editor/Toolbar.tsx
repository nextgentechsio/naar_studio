"use client";

import { useState, type ReactNode } from "react";
import { PEN_COLORS, SHAPE_KINDS, STICKY_COLORS, type PenColor, type ShapeKind, type StickyColor } from "@/lib/boards/shared";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { COLORS, PEN } from "./ItemView";

// --------------------------------------------------
// THE BOARD TOOLBAR (bottom centre)
//
// Select and Hand stacked on the left; then the big
// illustrated tools (marker, sticky notes, shapes) that
// sit low in the bar and rise out of it when hovered or
// chosen; then simple tools (text, frame); then media.
// A chosen tool opens a small tray above it: colours, or
// the kinds of shape and the connector.
// --------------------------------------------------

export type Tool = "select" | "hand" | "draw" | "sticky" | "text" | "shape" | "connector" | "frame";

type Props = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  shapeKind: ShapeKind;
  onShapeKind: (kind: ShapeKind) => void;
  stickyColor: StickyColor;
  onStickyColor: (color: StickyColor) => void;
  penColor: PenColor;
  onPenColor: (color: PenColor) => void;
  onMedia: (kind: "image" | "video") => void;
};

export default function Toolbar(props: Props) {
  const { tool, onTool } = props;
  const [more, setMore] = useState(false);
  const shapes = tool === "shape" || tool === "connector";

  return (
    <div className="board-glass relative flex h-[76px] items-stretch rounded-2xl" role="toolbar" aria-label="Board tools">
      {/* Select / Hand */}
      <div className="flex w-12 flex-col overflow-hidden rounded-l-2xl border-r border-line">
        {(
          [
            ["select", "cursor", "Select (V)"],
            ["hand", "hand", "Hand (H) · or hold Space"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onTool(id)}
            title={label}
            aria-label={label}
            aria-pressed={tool === id}
            className={cx(
              "flex flex-1 items-center justify-center transition-colors",
              tool === id ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-raised hover:text-fg"
            )}
          >
            <Icon name={icon} size={17} />
          </button>
        ))}
      </div>

      {/* Big illustrated tools */}
      <div className="flex items-end gap-1 px-2">
        <BigTool label="Marker (M)" active={tool === "draw"} onClick={() => onTool("draw")} tray={tool === "draw" && <PenTray {...props} />}>
          <MarkerArt color={PEN[props.penColor].stroke} />
        </BigTool>
        <BigTool label="Sticky note (S)" active={tool === "sticky"} onClick={() => onTool("sticky")} tray={tool === "sticky" && <StickyTray {...props} />}>
          <StickiesArt color={COLORS[props.stickyColor].fill} />
        </BigTool>
        <BigTool label="Shapes and connector (R · L)" active={shapes} onClick={() => onTool("shape")} tray={shapes && <ShapeTray {...props} />}>
          <ShapesArt />
        </BigTool>
      </div>

      <span className="my-3 w-px bg-line" aria-hidden />

      {/* Simple tools */}
      <div className="flex items-center gap-1.5 px-2.5">
        <LineTool label="Text (T)" active={tool === "text"} onClick={() => onTool("text")}>
          <Icon name="type" size={19} />
        </LineTool>
        <LineTool label="Frame (F)" active={tool === "frame"} onClick={() => onTool("frame")}>
          <Icon name="frame" size={19} />
        </LineTool>
      </div>

      <span className="my-3 w-px bg-line" aria-hidden />

      {/* Media */}
      <div className="flex items-end gap-1 pl-1 pr-2">
        <BigTool label="Add pictures" onClick={() => props.onMedia("image")} narrow>
          <PhotoArt />
        </BigTool>
        <div className="relative flex items-center">
          <LineTool label="More: pictures or videos" active={more} onClick={() => setMore((open) => !open)}>
            <Icon name="plus" size={19} />
          </LineTool>
          {more && (
            <div className="glass-menu absolute bottom-full right-0 mb-3 w-56 rounded-xl border border-line p-1 shadow-xl" role="menu">
              {(["image", "video"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMore(false);
                    props.onMedia(kind);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-raised"
                >
                  <Icon name={kind} size={15} />
                  {kind === "image" ? "Pictures" : "Videos"}
                  <span className="ml-auto text-[11px] text-fg-subtle">History · library</span>
                </button>
              ))}
              <p className="px-3 pb-1.5 pt-1 text-[11px] text-fg-subtle">Or paste / drop from any website</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------
// TOOL BUTTONS
// --------------------------------------------------

// Clipped along the bottom only, so the art can rise out
// of the top of the bar
function BigTool({
  label,
  active,
  onClick,
  tray,
  narrow,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  tray?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative h-full">
      {tray && <div className="absolute bottom-full left-1/2 z-10 mb-9 -translate-x-1/2">{tray}</div>}
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={cx("group relative block h-full", narrow ? "w-14" : "w-[62px]")}
        style={{ clipPath: "inset(-48px -12px 0 -12px)" }}
      >
        <span
          className={cx(
            "absolute inset-x-0 bottom-0 flex justify-center transition-transform duration-200 ease-out",
            active ? "-translate-y-5" : "translate-y-4 group-hover:translate-y-0"
          )}
        >
          {children}
        </span>
      </button>
    </div>
  );
}

function LineTool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        "flex h-10 w-10 items-center justify-center rounded-xl border-[1.5px] transition-colors",
        active ? "border-accent bg-accent text-on-accent" : "border-fg/70 text-fg hover:bg-raised"
      )}
    >
      {children}
    </button>
  );
}

// --------------------------------------------------
// TRAYS (above the chosen tool)
// --------------------------------------------------

function Tray({ children }: { children: ReactNode }) {
  return <div className="board-glass flex items-center gap-1 rounded-xl p-1.5">{children}</div>;
}

function Swatch({ color, label, active, onClick, round = true }: { color: string; label: string; active: boolean; onClick: () => void; round?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        "h-6 w-6 border border-black/10 transition-transform hover:scale-110",
        round ? "rounded-full" : "rounded-[5px]",
        active && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--glass)]"
      )}
      style={{ background: color }}
    />
  );
}

function PenTray({ penColor, onPenColor }: Props) {
  return (
    <Tray>
      {PEN_COLORS.map((color) => (
        <Swatch key={color} color={PEN[color].stroke} label={PEN[color].label} active={penColor === color} onClick={() => onPenColor(color)} />
      ))}
    </Tray>
  );
}

function StickyTray({ stickyColor, onStickyColor }: Props) {
  return (
    <Tray>
      {STICKY_COLORS.map((color) => (
        <Swatch key={color} color={COLORS[color].fill} label={COLORS[color].label} active={stickyColor === color} onClick={() => onStickyColor(color)} round={false} />
      ))}
    </Tray>
  );
}

function ShapeTray({ tool, onTool, shapeKind, onShapeKind }: Props) {
  const icons: Record<ShapeKind, "square" | "circle" | "diamond" | "triangle"> = { rect: "square", ellipse: "circle", diamond: "diamond", triangle: "triangle" };
  const labels: Record<ShapeKind, string> = { rect: "Rectangle (R)", ellipse: "Ellipse (O)", diamond: "Diamond", triangle: "Triangle" };
  return (
    <Tray>
      {SHAPE_KINDS.map((kind) => (
        <TrayButton
          key={kind}
          label={labels[kind]}
          active={tool === "shape" && shapeKind === kind}
          onClick={() => {
            onShapeKind(kind);
            onTool("shape");
          }}
        >
          <Icon name={icons[kind]} size={17} />
        </TrayButton>
      ))}
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <TrayButton label="Connector (L)" active={tool === "connector"} onClick={() => onTool("connector")}>
        <Icon name="connector" size={17} />
      </TrayButton>
    </Tray>
  );
}

function TrayButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx("flex h-8 w-8 items-center justify-center rounded-lg transition-colors", active ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-raised hover:text-fg")}
    >
      {children}
    </button>
  );
}

// --------------------------------------------------
// ILLUSTRATIONS (ours; 56 × 76, drawn to sit low in the bar)
// --------------------------------------------------

function MarkerArt({ color }: { color: string }) {
  return (
    <svg width="44" height="76" viewBox="0 0 44 76" aria-hidden>
      <g transform="rotate(-6 22 40)">
        {/* Tip */}
        <path d="M14 22 L22 4 L30 22 Z" fill="#EFE7DA" stroke="#CFC6B6" strokeWidth="1" />
        <path d="M19.4 10 L22 4 L24.6 10 Z" fill={color} />
        {/* Collar and body */}
        <rect x="12" y="20" width="20" height="9" rx="2.5" fill={color} stroke="#D9D9D4" strokeWidth="1" />
        <rect x="11" y="27" width="22" height="52" rx="7" fill="#F7F7F5" stroke="#D9D9D4" strokeWidth="1" />
        <rect x="15" y="31" width="3" height="40" rx="1.5" fill="#FFFFFF" opacity="0.9" />
      </g>
    </svg>
  );
}

function StickiesArt({ color }: { color: string }) {
  return (
    <svg width="56" height="64" viewBox="0 0 56 64" aria-hidden>
      <rect x="10" y="12" width="38" height="38" rx="3" fill="#D8CFB7" transform="rotate(9 29 31)" />
      <rect x="8" y="14" width="38" height="38" rx="3" fill="#EADFC0" transform="rotate(4 27 33)" />
      <g transform="rotate(-4 27 34)">
        <path d="M6 16 H44 a2 2 0 0 1 2 2 V44 L36 54 H8 a2 2 0 0 1 -2 -2 Z" fill={color} />
        <path d="M46 44 L36 54 V46 a2 2 0 0 1 2 -2 Z" fill="#000" opacity="0.12" />
      </g>
    </svg>
  );
}

function ShapesArt() {
  return (
    <svg width="60" height="64" viewBox="0 0 60 64" aria-hidden>
      <circle cx="17" cy="20" r="12" fill="#9C8BF7" />
      <rect x="32" y="8" width="22" height="22" rx="3" fill="#8D7CF2" />
      <path d="M17 34 L30 56 H4 Z" fill="#7B68EA" />
      <path d="M38 40 V52 a3 3 0 0 0 3 3 H52" fill="none" stroke="#8C8C8C" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M48 50.5 L53 55 L48 59.5" fill="none" stroke="#8C8C8C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhotoArt() {
  return (
    <svg width="46" height="58" viewBox="0 0 46 58" aria-hidden>
      <g transform="rotate(-7 23 30)">
        <rect x="4" y="6" width="38" height="46" rx="3" fill="#FFFFFF" stroke="#D9D9D4" strokeWidth="1" />
        <rect x="8" y="10" width="30" height="28" rx="1.5" fill="#BFE0F5" />
        <circle cx="30" cy="17" r="4" fill="#FFD166" />
        <path d="M8 38 L18 25 L25 33 L29 28 L38 38 Z" fill="#5FB27E" />
      </g>
    </svg>
  );
}

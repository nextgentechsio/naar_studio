"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// BOARD MENUS: the right-click menu and the download menu
// share these rows
// --------------------------------------------------

export type MenuEntry =
  | { kind: "item"; label: string; hint?: string; shortcut?: string; icon?: IconName; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "heading"; label: string }
  | { kind: "separator" };

export function MenuList({ entries, onDone }: { entries: MenuEntry[]; onDone: () => void }) {
  return (
    <div className="board-glass-solid w-64 rounded-xl p-1 text-sm" role="menu" onPointerDown={(event) => event.stopPropagation()}>
      {entries.map((entry, index) =>
        entry.kind === "separator" ? (
          <div key={index} className="mx-2 my-1 h-px bg-line" role="separator" />
        ) : entry.kind === "heading" ? (
          <p key={index} className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
            {entry.label}
          </p>
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onDone();
              entry.onSelect();
            }}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors disabled:opacity-40",
              entry.danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-raised"
            )}
          >
            {entry.icon ? <Icon name={entry.icon} size={15} className="text-fg-muted" /> : <span className="w-[15px]" aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              {entry.hint && <span className="block truncate text-[11px] text-fg-subtle">{entry.hint}</span>}
            </span>
            {entry.shortcut && <span className="shrink-0 text-[11px] text-fg-subtle">{entry.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

// A menu at a screen point, kept inside the window; closes
// on a click elsewhere, Escape, scrolling or resizing
export function FloatingMenu({ at, entries, onClose }: { at: { x: number; y: number }; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8)),
    });
  }, [at]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof PointerEvent && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="fixed z-[60]" style={{ left: pos.x, top: pos.y }} onContextMenu={(event) => event.preventDefault()}>
      <MenuList entries={entries} onDone={onClose} />
    </div>
  );
}

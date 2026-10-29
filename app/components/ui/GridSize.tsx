"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// GRID SIZE (small, medium or large cards)
//
// Each grid (History, Elements, the library window…)
// remembers its own choice in this browser. The server
// render and first paint use medium, then the saved
// size, so nothing mismatches while hydrating.
// --------------------------------------------------

export type GridSize = "s" | "m" | "l";

const SIZES: { id: GridSize; label: string; icon: "gridSmall" | "gridMedium" | "gridLarge" }[] = [
  { id: "s", label: "Small", icon: "gridSmall" },
  { id: "m", label: "Medium", icon: "gridMedium" },
  { id: "l", label: "Large", icon: "gridLarge" },
];

// Columns for a page-wide grid, and for one in a window
export const PAGE_GRID: Record<GridSize, string> = {
  s: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8",
  m: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
  l: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
};

export const DIALOG_GRID: Record<GridSize, string> = {
  s: "grid-cols-3 sm:grid-cols-6",
  m: "grid-cols-2 sm:grid-cols-4",
  l: "grid-cols-1 sm:grid-cols-2",
};

const key = (place: string) => `grid-size:${place}`;
const listeners = new Set<() => void>();

function read(place: string): GridSize {
  try {
    const saved = localStorage.getItem(key(place));
    return saved === "s" || saved === "l" ? saved : "m";
  } catch {
    return "m";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing it
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useGridSize(place: string): [GridSize, (size: GridSize) => void] {
  const size = useSyncExternalStore(
    subscribe,
    () => read(place),
    () => "m" as GridSize
  );

  function setSize(next: GridSize) {
    try {
      localStorage.setItem(key(place), next);
    } catch {
      // Private mode: just this view
    }
    listeners.forEach((listener) => listener());
  }

  return [size, setSize];
}

export function GridSizeToggle({
  size,
  onChange,
  className,
}: {
  size: GridSize;
  onChange: (size: GridSize) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Grid size"
      className={cx("inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5", className)}
    >
      {SIZES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={size === item.id}
          aria-label={`${item.label} cards`}
          title={`${item.label} cards`}
          onClick={() => onChange(item.id)}
          className={cx(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            size === item.id ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg"
          )}
        >
          <Icon name={item.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// --------------------------------------------------
// DRAG TO REORDER (mouse, pen and touch)
//
// The grabbed item lifts and follows the pointer; the
// others glide out of its way as it passes them (FLIP:
// measured before and after each change, then animated
// from the old place to the new); on release it settles
// into its slot. A drag starts after a few pixels of
// movement, so a plain click still clicks.
//
// items: ids in their current order (e.g. file URLs).
// Render `order` (the live order while dragging), give
// each item's element itemProps(id), skip clicks while
// justDragged(), and mark controls inside an item that
// mustn't start a drag (remove buttons, players) with
// data-no-drag.
// --------------------------------------------------

const START_DISTANCE = 4;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

type Grab = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  // Pointer to item centre, at the grab
  offsetX: number;
  offsetY: number;
  // Current shift of the item from its slot
  dx: number;
  dy: number;
  started: boolean;
};

// Where an item sits in the layout, ignoring any glide
// or drag shift on it (offsets don't include transforms),
// so a neighbour still gliding away isn't hit again
function slot(element: HTMLElement) {
  const parent = element.offsetParent as HTMLElement | null;
  const origin = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const left = origin.left + (parent ? parent.clientLeft - parent.scrollLeft : 0) + element.offsetLeft;
  const top = origin.top + (parent ? parent.clientTop - parent.scrollTop : 0) + element.offsetTop;
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSortable(items: string[], onReorder: (next: string[]) => void, enabled = true) {
  const elements = useRef(new Map<string, HTMLElement>());
  const grab = useRef<Grab | null>(null);
  // Where items were before the last change (FLIP)
  const before = useRef<Map<string, DOMRect> | null>(null);
  const frame = useRef(0);
  const dragged = useRef(false);

  const [dragging, setDragging] = useState<string | null>(null);
  const [live, setLive] = useState<string[] | null>(null);
  const order = live ?? items;

  // Latest values for the window listeners
  const latest = useRef({ order, items, onReorder });
  latest.current = { order, items, onReorder };

  function snapshot() {
    const rects = new Map<string, DOMRect>();
    elements.current.forEach((element, id) => rects.set(id, element.getBoundingClientRect()));
    before.current = rects;
  }

  // Puts the grabbed item under the pointer (by centres,
  // so its lifted scale doesn't matter)
  function follow() {
    const current = grab.current;
    const element = current && elements.current.get(current.id);
    if (!current || !element) return;

    const home = slot(element);
    current.dx = current.x - current.offsetX - (home.left + home.right) / 2;
    current.dy = current.y - current.offsetY - (home.top + home.bottom) / 2;
    element.style.translate = `${current.dx}px ${current.dy}px`;
  }

  // Others glide from where they were; the grabbed one
  // stays under the pointer
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (rects && !reducedMotion()) {
      elements.current.forEach((element, id) => {
        if (id === grab.current?.id && grab.current.started) return;
        const old = rects.get(id);
        if (!old) return;
        const now = element.getBoundingClientRect();
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        element.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 280, easing: EASE });
      });
    }
    if (grab.current?.started) follow();
  }, [order]);

  // The item under the pointer takes the grabbed one's
  // place
  function overId(x: number, y: number): string | null {
    for (const [id, element] of elements.current) {
      if (id === grab.current?.id) continue;
      const rect = slot(element);
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
    }
    return null;
  }

  function onMove(event: PointerEvent) {
    const current = grab.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;

    if (!current.started) {
      if (Math.hypot(current.x - current.startX, current.y - current.startY) < START_DISTANCE) return;
      current.started = true;
      dragged.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      setDragging(current.id);
    }

    event.preventDefault();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      follow();
      const target = overId(current.x, current.y);
      if (!target) return;
      const now = latest.current.order;
      const from = now.indexOf(current.id);
      const to = now.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...now];
      next.splice(from, 1);
      next.splice(to, 0, current.id);
      snapshot();
      setLive(next);
    });
  }

  function onUp(event: PointerEvent) {
    const current = grab.current;
    if (!current || event.pointerId !== current.pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    cancelAnimationFrame(frame.current);
    grab.current = null;
    if (!current.started) return;

    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    // Settle into the slot
    const element = elements.current.get(current.id);
    if (element) {
      element.style.translate = "";
      if (!reducedMotion()) {
        element.animate([{ translate: `${current.dx}px ${current.dy}px` }, { translate: "0 0" }], {
          duration: 240,
          easing: EASE,
        });
      }
    }

    const { order: final, items: original, onReorder: commit } = latest.current;
    if (final.join("\n") !== original.join("\n")) commit(final);
    setLive(null);
    setDragging(null);
    // The click that ends a drag isn't a click
    setTimeout(() => (dragged.current = false), 0);
  }

  function itemProps(id: string) {
    return {
      ref: (element: HTMLElement | null) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || grab.current || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        grab.current = {
          id,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          offsetX: event.clientX - (rect.left + rect.width / 2),
          offsetY: event.clientY - (rect.top + rect.height / 2),
          dx: 0,
          dy: 0,
          started: false,
        };
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      },
      // Touch drags the item, not the page
      style: enabled ? { touchAction: "none" as const } : undefined,
      "data-lifted": dragging === id || undefined,
    };
  }

  // Moves one place by keys, animated like a drag
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    snapshot();
    onReorder(next);
  }

  return { order, dragging, itemProps, move, justDragged: () => dragged.current };
}

"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// --------------------------------------------------
// MODAL DIALOG BEHAVIOUR
//
// While mounted: focus moves into the dialog, Tab and
// Shift+Tab stay inside it, Escape closes it, the page
// behind doesn't scroll. On close, focus returns to
// whatever opened it.
// --------------------------------------------------

export function useDialog(
  container: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  // Latest onClose without re-running the effect (which
  // would steal focus back on every parent render)
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [...(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

    (container.current?.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
      focusables()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      // Another dialog opened on top of this one has the
      // keys until it closes
      const active = document.activeElement;
      if (
        !container.current?.contains(active) &&
        active?.closest('[aria-modal="true"]') &&
        !active.closest('[aria-modal="true"]')?.contains(container.current)
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];
      const inside = container.current?.contains(active);

      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [container]);
}

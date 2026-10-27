"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Button, cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// MODAL WINDOW
//
// Pops in on wide screens, slides up as a bottom sheet
// on phones, and plays out before it unmounts. Focus,
// Tab, Escape and scroll locking come from useDialog.
//
// Children get `close`, which animates out and then
// calls onClose; use it for every way of closing.
// --------------------------------------------------

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-3xl",
};

// Longest exit animation, in case animationend never
// comes (e.g. the tab is hidden)
const EXIT_MS = 240;

export function Modal({
  title,
  subtitle,
  size = "md",
  onClose,
  header,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  size?: keyof typeof SIZES;
  onClose: () => void;
  // Extra content under the title row (e.g. tabs)
  header?: (close: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;

    const node = panel.current;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onCloseRef.current();
    };
    // Only the panel's own exit, not something inside it
    const onEnd = (event: AnimationEvent) => {
      if (event.target === node) done();
    };
    const timer = setTimeout(done, EXIT_MS);
    node?.addEventListener("animationend", onEnd);

    return () => {
      clearTimeout(timer);
      node?.removeEventListener("animationend", onEnd);
    };
  }, [closing]);

  useDialog(panel, close);

  const state = closing ? "closing" : "open";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        data-state={state}
        className="ui-backdrop absolute inset-0 bg-black/40 backdrop-blur-[3px]"
        onClick={close}
      />

      <div
        ref={panel}
        data-state={state}
        className={cx(
          "ui-panel relative flex max-h-[92dvh] w-full flex-col glass rounded-t-2xl border sm:max-h-[min(44rem,calc(100dvh-2rem))] sm:rounded-xl",
          SIZES[size]
        )}
      >
        {/* Grab handle: it's a sheet on phones */}
        <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" />

        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 sm:pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-fg">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
          </div>
          <Button size="sm" variant="ghost" icon="close" aria-label="Close" onClick={close} className="-mr-2 shrink-0" />
        </div>

        {header?.(close)}

        {children(close)}
      </div>
    </div>,
    document.body
  );
}

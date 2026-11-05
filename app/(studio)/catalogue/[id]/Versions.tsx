"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ShotRun } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import CroppedImage, { croppedRatio } from "../_parts/CroppedImage";
import Generating from "../_parts/Generating";
import { timeAgo } from "../_parts/product-ui";

// --------------------------------------------------
// A SHOT'S VERSIONS: the big preview of one run, and
// the strip of every run (newest first) to pick from
// --------------------------------------------------

// Generated images are 3:4 until one loads and says
export const DEFAULT_RATIO = 3 / 4;

// Remembers each image's real width / height once loaded
export function useImageRatio() {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  return {
    ratioOf: (url: string | null | undefined) => (url && ratios[url]) || DEFAULT_RATIO,
    setRatio: (url: string, ratio: number) =>
      setRatios((current) => (Math.abs((current[url] ?? 0) - ratio) < 0.001 ? current : { ...current, [url]: ratio })),
  };
}

// The height left on screen below an element's top
// (scroll position aside), minus `reserve` px below it;
// kept up to date as the window or the page changes
function useRoomBelow(reserve: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (reserve === undefined || !element) return;
    const measure = () => {
      // In a window (fixed) the page's scroll doesn't count
      const scroll = element.closest('[role="dialog"]') ? 0 : window.scrollY;
      const top = element.getBoundingClientRect().top + scroll;
      setRoom(Math.max(240, Math.floor(window.innerHeight - top - reserve)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [reserve]);
  return { ref, room };
}

export function RunPreview({
  run,
  alt,
  className,
  initial = false,
  fit,
  onCrop,
  imageRatio,
  onRatio,
}: {
  run: ShotRun | null;
  alt: string;
  className?: string;
  initial?: boolean;
  // Fits the whole preview on screen: px to keep free
  // below it (for what follows it on the page)
  fit?: number;
  // Shows a Crop button on a finished image
  onCrop?: () => void;
  // The image's width / height, once known
  imageRatio?: number;
  onRatio?: (url: string, ratio: number) => void;
}) {
  const ratio = imageRatio ?? DEFAULT_RATIO;
  const shown = run?.imageUrl ? croppedRatio(ratio, run.crop) : DEFAULT_RATIO;
  const { ref, room } = useRoomBelow(fit);
  return (
    <div
      ref={ref}
      className={cx("relative mx-auto overflow-hidden rounded-2xl border border-line bg-sunken", className)}
      style={{
        aspectRatio: shown,
        ...(room ? { width: `min(100%, ${Math.floor(room * shown)}px)` } : {}),
      }}
    >
      {run?.imageUrl ? (
        <>
          <CroppedImage
            key={run.imageUrl}
            src={run.imageUrl}
            crop={run.crop}
            imageRatio={ratio}
            boxRatio={shown}
            alt={alt}
            onRatio={(value) => onRatio?.(run.imageUrl!, value)}
            className="ui-rise"
          />
          {onCrop && run.status === "succeeded" && (
            <button
              type="button"
              onClick={onCrop}
              className="glass absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-fg shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              <Icon name="crop" size={14} />
              {run.crop ? "Edit crop" : "Crop"}
            </button>
          )}
          {run.crop && (
            <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
              Cropped
            </span>
          )}
        </>
      ) : run?.status === "pending" ? (
        <Generating run={run} initial={initial} />
      ) : run?.status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <Icon name="alert" size={20} />
          </span>
          <span className="text-sm font-medium text-fg">This version failed</span>
          {run.error && <span className="max-w-xs text-xs text-fg-muted">{run.error}</span>}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-fg-subtle">
          <Icon name="image" size={32} />
          <span className="text-sm">Nothing generated yet</span>
        </div>
      )}
    </div>
  );
}

export function VersionStrip({
  runs,
  selected,
  viewing,
  onView,
  className,
}: {
  // e.g. a column beside the preview on wide screens
  className?: string;
  runs: ShotRun[];
  // The version in use
  selected: string | null;
  // The version shown in the preview
  viewing: string | null;
  onView: (run: ShotRun) => void;
}) {
  if (!runs.length) return null;

  return (
    <ul aria-label="Versions" className={cx("flex gap-2 overflow-x-auto pb-1", className)}>
      {runs.map((run, index) => {
        const inUse = run.generationId === selected;
        const shown = run.generationId === viewing;
        const label = `Version ${runs.length - index}${inUse ? " (in use)" : ""}${run.status === "failed" ? " (failed)" : run.status === "pending" ? " (generating)" : ""}`;
        return (
          <li key={run.generationId} className="shrink-0">
            <button
              type="button"
              onClick={() => onView(run)}
              aria-pressed={shown}
              aria-label={label}
              title={[label, run.feedback && `“${run.feedback}”`, timeAgo(run.createdAt)].filter(Boolean).join(" · ")}
              className={cx(
                "relative block aspect-3/4 w-16 overflow-hidden rounded-lg border bg-sunken transition-all duration-200 sm:w-[72px]",
                shown ? "border-accent ring-2 ring-accent/40" : "border-line hover:-translate-y-0.5 hover:border-line-strong",
              )}
            >
              {run.imageUrl ? (
                <CroppedImage
                  src={run.imageUrl}
                  crop={run.crop}
                  imageRatio={DEFAULT_RATIO}
                  boxRatio={DEFAULT_RATIO}
                  alt=""
                  loading="lazy"
                />
              ) : run.status === "pending" ? (
                <Generating run={run} size="tiny" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-danger">
                  <Icon name="alert" size={16} />
                </span>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                v{runs.length - index}
              </span>
              {inUse && (
                <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
                  <Icon name="check" size={10} />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

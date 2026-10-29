"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import type { Element } from "@/lib/element-mentions";

// --------------------------------------------------
// AN ELEMENT'S PHOTOS AND VIDEOS, FULL SIZE
//
// Opens on the one clicked (the cover or a reference in
// the card's corner) and steps through the rest: arrows,
// ← → keys, or the strip of thumbnails. Whole pictures,
// never cropped. Escape or a click outside closes it.
// --------------------------------------------------

type Item = { url: string; kind: "image" | "video" };

export function galleryItems(element: Pick<Element, "images" | "videos">): Item[] {
  return [
    ...element.images.map((url) => ({ url, kind: "image" as const })),
    ...element.videos.map((url) => ({ url, kind: "video" as const })),
  ];
}

export default function ElementGallery({
  element,
  start = 0,
  onClose,
}: {
  // A saved element, or one still being made (its name
  // and files so far)
  element: Pick<Element, "name" | "images" | "videos" | "addedBy">;
  start?: number;
  onClose: () => void;
}) {
  const items = galleryItems(element);
  const [index, setIndex] = useState(Math.min(start, items.length - 1));
  const panel = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);

  useDialog(panel, onClose);

  // Keep the current thumbnail in view
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  const step = (by: number) => setIndex((current) => (current + by + items.length) % items.length);

  function onKeyDown(event: KeyboardEvent) {
    if (items.length < 2) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  const item = items[index];
  if (!item) return null;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={`@${element.name}: ${item.kind} ${index + 1} of ${items.length}`}
      onKeyDown={onKeyDown}
      className="ui-backdrop fixed inset-0 z-50 flex flex-col"
    >
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/85 backdrop-blur-md" />

      {/* Name, place, close */}
      <div className="relative flex items-center justify-between gap-3 px-5 py-4 text-white">
        <p className="min-w-0 truncate text-sm">
          <span className="font-semibold">@{element.name}</span>
          {element.addedBy && <span className="text-white/60"> · by {element.addedBy.name}</span>}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-white/70" aria-live="polite">
            {index + 1} / {items.length}
          </span>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the original in a new tab"
            title="Open original"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <Icon name="upscale" size={15} />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-autofocus
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      {/* The picture, whole */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-center justify-center px-16 pb-3">
        {item.kind === "video" ? (
          <video
            key={item.url}
            src={item.url}
            controls
            autoPlay
            playsInline
            className="ui-menu pointer-events-auto max-h-full max-w-full rounded-xl bg-black shadow-2xl"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.url}
            src={item.url}
            alt={`@${element.name}, image ${index + 1}`}
            // Fills the space (small files too); clicks beside
            // the picture reach the backdrop and close
            className="ui-menu h-full w-full object-contain drop-shadow-2xl"
          />
        )}

        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous"
              className="pointer-events-auto absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <Icon name="chevronLeft" size={20} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="pointer-events-auto absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <Icon name="chevronRight" size={20} />
            </button>
          </>
        )}
      </div>

      {/* Every photo and video, to jump to */}
      {items.length > 1 && (
        <ul ref={strip} className="relative mx-auto flex max-w-full gap-2 overflow-x-auto px-5 pb-5 pt-1" aria-label="All files">
          {items.map((entry, position) => (
            <li key={entry.url} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`${entry.kind === "video" ? "Video" : "Image"} ${position + 1}`}
                aria-current={position === index}
                className={cx(
                  "relative block h-16 w-16 overflow-hidden rounded-lg border-2 transition-all",
                  position === index ? "border-white opacity-100" : "border-transparent opacity-55 hover:opacity-90"
                )}
              >
                {entry.kind === "video" ? (
                  <>
                    <video src={`${entry.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center text-white">
                      <Icon name="play" size={14} />
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={entry.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body
  );
}

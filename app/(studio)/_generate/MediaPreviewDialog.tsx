"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Icon } from "@/app/components/ui/Icon";
import { describeMedia, useMediaMeta } from "@/lib/client/media-meta";

// --------------------------------------------------
// FULL-SIZE PREVIEW OF AN UPLOADED IMAGE OR VIDEO
//
// Grows out of the tile that opened it and shrinks back
// into it on close. The media's own size is known up
// front (from the tile), so the final box is set before
// the first paint and the animation has a fixed target.
// --------------------------------------------------

export type MediaPreview = {
  src: string;
  kind: "image" | "video";
  alt: string;
  // The tile it opens from
  origin: DOMRect;
  width: number;
  height: number;
  // The uploaded file, for its size (src may be a local
  // preview of it)
  sizeOf?: string | null;
};

const OPEN_MS = 340;
const CLOSE_MS = 240;
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";

// Largest box with the media's shape that fits the window
function fit(width: number, height: number) {
  const maxWidth = Math.min(window.innerWidth * 0.9, 1100);
  const maxHeight = window.innerHeight * 0.82;
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const w = Math.min(maxWidth, maxHeight * ratio);

  return { width: Math.round(w), height: Math.round(w / ratio) };
}

// Transform that puts the box over the tile
function fromOrigin(box: DOMRect, origin: DOMRect) {
  const scale = Math.max(origin.width / box.width, origin.height / box.height);
  const dx = origin.left + origin.width / 2 - (box.left + box.width / 2);
  const dy = origin.top + origin.height / 2 - (box.top + box.height / 2);

  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function MediaPreviewDialog({
  preview,
  onClose,
}: {
  preview: MediaPreview;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const size = fit(preview.width, preview.height);
  const { meta, bytes } = useMediaMeta(preview.src, preview.kind, preview.sizeOf ?? null);
  const details = describeMedia(meta, bytes);

  // OPEN
  useLayoutEffect(() => {
    if (reducedMotion() || !media.current) return;

    const box = media.current.getBoundingClientRect();

    media.current.animate(
      [
        { transform: fromOrigin(box, preview.origin), opacity: 0.4, borderRadius: "24px" },
        { transform: "none", opacity: 1, borderRadius: "12px" },
      ],
      { duration: OPEN_MS, easing: EASE }
    );
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: OPEN_MS,
      easing: "ease-out",
    });
  }, [preview.origin]);

  // CLOSE: play the opening backwards, then unmount
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;

    if (reducedMotion() || !media.current) {
      onClose();
      return;
    }

    const box = media.current.getBoundingClientRect();
    const options = { duration: CLOSE_MS, easing: EASE, fill: "forwards" as const };

    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], options);
    media.current
      .animate(
        [
          { transform: "none", opacity: 1 },
          { transform: fromOrigin(box, preview.origin), opacity: 0 },
        ],
        options
      )
      .finished.then(onClose, onClose);
  }, [onClose, preview.origin]);

  useDialog(root, close);

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={preview.alt}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4"
    >
      <div
        ref={backdrop}
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />

      <div
        ref={media}
        className="relative overflow-hidden rounded-xl bg-black shadow-2xl"
        style={size}
      >
        {preview.kind === "video" ? (
          <video
            src={preview.src}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.src}
            alt={preview.alt}
            className="h-full w-full object-contain"
          />
        )}
      </div>

      {/* Fades in with the media; reserved height so the
          box doesn't move when it appears */}
      <p className="relative min-h-5 text-sm tabular-nums text-white/80">{details}</p>

      <button
        type="button"
        aria-label="Close preview"
        onClick={close}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
      >
        <Icon name="close" size={18} />
      </button>
    </div>,
    document.body
  );
}

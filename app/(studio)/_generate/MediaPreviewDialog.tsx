"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Icon } from "@/app/components/ui/Icon";
import { describeMedia, useMediaMeta } from "@/lib/client/media-meta";

// --------------------------------------------------
// FULL-SIZE PREVIEW OF AN IMAGE OR VIDEO
//
// Grows out of the tile that opened it and shrinks back
// into it on close. The media's own size is known up
// front (from the tile), so the final box is set before
// the first paint and the animation has a fixed target.
//
// With a gallery (a run's several outputs), ‹ › and the
// arrow keys step through them; each one's size comes
// from the file once it loads. onDownload adds a
// Download button.
// --------------------------------------------------

export type PreviewItem = {
  src: string;
  kind: "image" | "video";
  alt: string;
  // Its tile now, to shrink back into on close
  origin?: () => DOMRect | null;
};

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
  gallery,
  startIndex = 0,
  onDownload,
}: {
  preview: MediaPreview;
  onClose: () => void;
  // Several items to step through; preview is the one at
  // startIndex
  gallery?: PreviewItem[];
  startIndex?: number;
  onDownload?: (item: { src: string; kind: "image" | "video" }, index: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const items: PreviewItem[] = gallery?.length ? gallery : [{ src: preview.src, kind: preview.kind, alt: preview.alt }];
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), items.length - 1));
  const current = items[index];
  const many = items.length > 1;

  // Each item's own size: the opening one's is known; the
  // others' arrive when their file loads
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>(() => ({
    [preview.src]: { width: preview.width, height: preview.height },
  }));
  const known = sizes[current.src];
  const size = fit(known?.width ?? preview.width, known?.height ?? preview.height);
  const measured = (width: number, height: number) => {
    if (width > 0 && height > 0 && !sizes[current.src]) setSizes((now) => ({ ...now, [current.src]: { width, height } }));
  };

  const { meta, bytes } = useMediaMeta(current.src, current.kind, current.src === preview.src ? (preview.sizeOf ?? null) : null);
  const details = describeMedia(meta, bytes);

  const step = useCallback(
    (by: number) => setIndex((now) => (now + by + items.length) % items.length),
    [items.length]
  );

  // ← → between items (Escape is useDialog's)
  useEffect(() => {
    if (!many) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      // A focused video's own seeking keeps the arrows
      if (target?.tagName === "VIDEO" || target?.tagName === "INPUT") return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [many, step]);

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
    // Back into the tile of the item showing now
    const target = current.origin?.() ?? preview.origin;

    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], options);
    media.current
      .animate(
        [
          { transform: "none", opacity: 1 },
          { transform: fromOrigin(box, target), opacity: 0 },
        ],
        options
      )
      .finished.then(onClose, onClose);
  }, [onClose, preview.origin, current]);

  useDialog(root, close);

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
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
        {current.kind === "video" ? (
          <video
            key={current.src}
            src={current.src}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            className="h-full w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.src}
            src={current.src}
            alt={current.alt}
            onLoad={(event) => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            className="h-full w-full object-contain"
          />
        )}
      </div>

      {/* Fades in with the media; reserved height so the
          box doesn't move when it appears */}
      <div className="relative flex min-h-8 flex-wrap items-center justify-center gap-3 text-sm tabular-nums text-white/80">
        {many && (
          <span className="font-medium text-white">
            {index + 1} of {items.length}
          </span>
        )}
        {details && <span>{details}</span>}
        {onDownload && (
          <button
            type="button"
            onClick={() => onDownload({ src: current.src, kind: current.kind }, index)}
            className="flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-medium text-white transition-colors hover:bg-white/25"
          >
            <Icon name="download" size={15} />
            Download
          </button>
        )}
      </div>

      {many && (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => step(-1)}
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 sm:left-5"
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => step(1)}
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 sm:right-5"
          >
            <Icon name="chevronRight" size={22} />
          </button>
        </>
      )}

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

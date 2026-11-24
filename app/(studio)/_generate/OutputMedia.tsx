"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import type { MediaPreview } from "./MediaPreviewDialog";

// --------------------------------------------------
// ONE IMAGE OR VIDEO OUTPUT, with a "view full size"
// button on the media's own corner (Create pages and
// History's drawer)
//
// The media is letterboxed in its element (object-
// contain), and the element may be smaller than the box
// it sits in, so neither corner is the picture's. The
// picture's box is worked out from the element's size,
// place and the file's shape, and the button put on it.
// Measuring doesn't change the layout. The parent must be
// positioned (relative).
// --------------------------------------------------

type Props = {
  src: string;
  kind: "image" | "video";
  alt: string;
  // The label of the full-size button
  viewLabel: string;
  onView: (element: HTMLImageElement | HTMLVideoElement) => void;
  // Extra classes for the image or video
  className?: string;
  onError?: () => void;
};

// What MediaPreviewDialog needs to grow out of a shown
// image or video
export function previewOf(element: HTMLImageElement | HTMLVideoElement, src: string, kind: "image" | "video", alt: string): MediaPreview {
  const video = element instanceof HTMLVideoElement;
  if (video) element.pause();
  const width = video ? element.videoWidth : element.naturalWidth;
  const height = video ? element.videoHeight : element.naturalHeight;
  return { src, kind, alt, origin: element.getBoundingClientRect(), width: width || 16, height: height || 9 };
}

export default function OutputMedia({ src, kind, alt, viewLabel, onView, className, onError }: Props) {
  const media = useRef<HTMLImageElement & HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [corner, setCorner] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const element = media.current;
    if (!element || !ratio) return;
    const place = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      const shown = Math.min(width, height * ratio);
      const parentWidth = (element.offsetParent as HTMLElement | null)?.clientWidth ?? width;
      setCorner({
        top: element.offsetTop + Math.max(0, (height - shown / ratio) / 2),
        right: parentWidth - (element.offsetLeft + width) + Math.max(0, (width - shown) / 2),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    if (element.offsetParent) observer.observe(element.offsetParent);
    return () => observer.disconnect();
  }, [ratio]);

  const measured = (width: number, height: number) => width > 0 && height > 0 && setRatio(width / height);
  const view = () => media.current && onView(media.current);

  return (
    <>
      {kind === "video" ? (
        <video
          ref={media}
          src={src}
          className={cx("h-full w-full object-contain", className)}
          controls
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          onError={onError}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={media}
          src={src}
          alt={alt}
          onClick={view}
          onLoad={(event) => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          onError={onError}
          className={cx("h-full w-full cursor-zoom-in object-contain", className)}
        />
      )}
      <button
        type="button"
        onClick={view}
        aria-label={viewLabel}
        title="View full size"
        style={{ top: (corner?.top ?? 0) + 8, right: (corner?.right ?? 0) + 8 }}
        className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icon name="expand" size={15} />
      </button>
    </>
  );
}

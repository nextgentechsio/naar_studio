"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";

// --------------------------------------------------
// ONE IMAGE OR VIDEO OUTPUT, with a "view full size"
// button on the media's own corner
//
// The media fills its cell and is letterboxed in it
// (object-contain), so the corner of the cell is not the
// corner of the picture. The picture's box is worked out
// from the cell's size and the file's shape, and the
// button placed on it. Measuring doesn't change the
// layout, so the panel sizes exactly as before.
// --------------------------------------------------

type Props = {
  src: string;
  kind: "image" | "video";
  alt: string;
  // The label of the full-size button
  viewLabel: string;
  onView: () => void;
};

export default function OutputMedia({ src, kind, alt, viewLabel, onView }: Props) {
  const media = useRef<HTMLImageElement & HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [inset, setInset] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    const element = media.current;
    if (!element || !ratio) return;
    const place = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      const shown = Math.min(width, height * ratio);
      setInset({ top: Math.max(0, (height - shown / ratio) / 2), right: Math.max(0, (width - shown) / 2) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ratio]);

  const measured = (width: number, height: number) => width > 0 && height > 0 && setRatio(width / height);

  return (
    <>
      {kind === "video" ? (
        <video
          ref={media}
          src={src}
          className="h-full w-full object-contain"
          controls
          muted
          playsInline
          onLoadedMetadata={(event) => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={media}
          src={src}
          alt={alt}
          onClick={onView}
          onLoad={(event) => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          className="h-full w-full cursor-zoom-in object-contain"
        />
      )}
      <button
        type="button"
        onClick={onView}
        aria-label={viewLabel}
        title="View full size"
        style={{ top: inset.top + 8, right: inset.right + 8 }}
        className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <Icon name="expand" size={15} />
      </button>
    </>
  );
}

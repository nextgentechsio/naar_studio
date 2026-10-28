"use client";

import { describeMedia, useMediaMeta, type MediaKind } from "@/lib/client/media-meta";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// A media tile's details along its bottom edge: "482×850"
// for an image, "0:09 · 482×850" for a video. Nothing
// until they're known. The full-size preview adds the
// file size.
// --------------------------------------------------

export default function MediaCaption({
  src,
  kind,
  className,
}: {
  src: string;
  kind: MediaKind;
  className?: string;
}) {
  const { meta } = useMediaMeta(src, kind);
  const text = describeMedia(meta);
  if (!text) return null;

  return (
    <span
      className={cx(
        "ui-rise pointer-events-none absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium leading-none tabular-nums text-white",
        className,
      )}
    >
      {text}
    </span>
  );
}

// The same details as plain text, with the file size
// ("0:05 · 720×1280 · 4.2 MB"); "—" until known
export function MediaDetails({ src, kind }: { src: string; kind: MediaKind | "file" }) {
  const { meta, bytes } = useMediaMeta(src, kind, src);
  return <>{describeMedia(meta, bytes) || "—"}</>;
}

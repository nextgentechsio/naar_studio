"use client";

import { useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { Spinner, cx } from "@/app/components/ui/primitives";
import { getOutputType } from "@/lib/client/outputs";
import { OUTPUT_RETENTION_DAYS } from "@/lib/storage/output-retention-days";

// --------------------------------------------------
// OUTPUT PREVIEW
//
// Thumbnail (grid) or full preview (drawer) of one
// generation, with clear states for running, failed
// and missing/expired outputs.
// --------------------------------------------------

export function isRunningStatus(status: string) {
  return !["succeeded", "failed", "canceled", "unknown"].includes(status);
}

export default function OutputPreview({
  url,
  contentType,
  status,
  variant,
  expired = false,
}: {
  url: string | null;
  contentType?: string | null;
  status: string;
  variant: "thumb" | "full";
  // Deleted by the retention cleanup
  expired?: boolean;
}) {
  // Replicate URLs expire; show a placeholder instead of
  // a broken image
  const [broken, setBroken] = useState(false);

  const type = url ? getOutputType(url, contentType) : null;
  const thumb = variant === "thumb";

  if (isRunningStatus(status)) {
    return (
      <Placeholder>
        <Spinner className="h-5 w-5 text-accent" />
        <span>Generating…</span>
      </Placeholder>
    );
  }

  if (status === "failed" || status === "canceled" || status === "unknown") {
    return (
      <Placeholder>
        <Icon
          name="alert"
          size={20}
          className={status === "unknown" ? "text-warning" : "text-danger"}
        />
        <span>
          {status === "failed"
            ? "Failed"
            : status === "canceled"
              ? "Canceled"
              : "Lost: Replicate no longer has this run"}
        </span>
      </Placeholder>
    );
  }

  if (expired && !url) {
    return (
      <Placeholder>
        <Icon name="clock" size={20} />
        <span>
          {thumb
            ? `Deleted after ${OUTPUT_RETENTION_DAYS} days`
            : `Files are kept for ${OUTPUT_RETENTION_DAYS} days, so this one was deleted. Use Run again to recreate it.`}
        </span>
      </Placeholder>
    );
  }

  if (!url || broken) {
    return (
      <Placeholder>
        <Icon name="image" size={20} />
        <span>{url ? "Preview unavailable" : "No output saved"}</span>
      </Placeholder>
    );
  }

  if (type === "video") {
    return (
      <>
        <video
          // #t= shows the first frame instead of black
          src={thumb ? `${url}#t=0.1` : url}
          // Whole frame in a card too (on black: a blurred
          // copy behind would load the video twice)
          className={cx(
            "h-full w-full object-contain",
            thumb ? "bg-black" : "max-h-[60vh]",
          )}
          muted
          playsInline
          preload="metadata"
          controls={!thumb}
          onError={() => setBroken(true)}
        />

        {/* Top right: the card's buttons take the bottom
            on hover, the "Hidden" tag the top left */}
        {thumb && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-[10px] font-medium text-white">
            <Icon name="play" size={10} />
            Video
          </span>
        )}
      </>
    );
  }

  if (type === "audio") {
    return thumb ? (
      <Placeholder>
        <Icon name="play" size={20} />
        <span>Audio</span>
      </Placeholder>
    ) : (
      <div className="flex w-full items-center p-4">
        <audio src={url} controls className="w-full" />
      </div>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading={thumb ? "lazy" : undefined}
      decoding="async"
      onError={() => setBroken(true)}
      className={cx(
        "h-full w-full object-contain",
        thumb ? "relative" : "max-h-[60vh]",
      )}
    />
  );

  // A card shows the whole picture (never cropped) on a
  // blurred copy of itself, as Elements does
  return thumb ? (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      {image}
    </>
  ) : (
    image
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-fg-subtle">
      {children}
    </div>
  );
}

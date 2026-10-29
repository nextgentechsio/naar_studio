"use client";

import { useRef, useState } from "react";
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
        {thumb ? (
          <VideoThumb url={url} onError={() => setBroken(true)} />
        ) : (
          <video
            src={url}
            className="h-full max-h-[60vh] w-full object-contain"
            muted
            playsInline
            preload="metadata"
            controls
            onError={() => setBroken(true)}
          />
        )}

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
        thumb ? `relative ${ZOOM}` : "max-h-[60vh]",
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

// Cards zoom their picture a little on hover
const ZOOM = "transition-transform duration-500 group-hover:scale-[1.03]";

// A video in a card: its whole first frame, on a blurred
// copy of that frame. The copy is drawn from the video
// already loading (onto a canvas, which may show another
// site's frame), so nothing is downloaded twice.
function VideoThumb({ url, onError }: { url: string; onError: () => void }) {
  const backdrop = useRef<HTMLCanvasElement>(null);

  function paint(video: HTMLVideoElement) {
    const canvas = backdrop.current;
    if (!canvas || !video.videoWidth) return;
    // Tiny: it's blurred anyway
    canvas.width = 48;
    canvas.height = Math.max(1, Math.round((48 * video.videoHeight) / video.videoWidth));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  return (
    <>
      <canvas
        ref={backdrop}
        aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <video
        // #t= shows the first frame instead of black
        src={`${url}#t=0.1`}
        className={cx("relative h-full w-full object-contain", ZOOM)}
        muted
        playsInline
        preload="metadata"
        onLoadedData={(event) => paint(event.currentTarget)}
        onSeeked={(event) => paint(event.currentTarget)}
        onError={onError}
      />
    </>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-fg-subtle">
      {children}
    </div>
  );
}

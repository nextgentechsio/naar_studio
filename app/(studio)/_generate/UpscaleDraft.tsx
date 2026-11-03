"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGenerateStore } from "@/app/(studio)/_generate/GenerateProvider";
import { Button, cx, formatCost } from "@/app/components/ui/primitives";
import { errorMessage } from "@/lib/client/http";
import { saveRunToLibrary } from "@/lib/client/library";
import { calculateReplicateCost, MODEL_IDS } from "@/lib/replicate/cost";

// --------------------------------------------------
// UPSCALE A DRAFT (Higgsfield video at 480p)
//
// Liked the draft? Make it sharper instead of running
// the model again: the same video, motion and sound,
// upscaled by Topaz Video Upscale (on Replicate) for a
// fraction of a new run. Higgsfield's API has no upscale
// of its own. The draft goes into the Library (Replicate
// needs a public link), then the Replicate page opens
// with Topaz ready; Generate there starts it.
// --------------------------------------------------

export const DRAFT_RESOLUTION = "480p";

const TARGETS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
] as const;

// Topaz's own default
const TARGET_FPS = 30;

// A finished Higgsfield video run made at draft size
export function isUpscalableDraft(run: {
  provider?: string | null;
  inputs?: Record<string, unknown> | null;
  outputType?: string | null;
}) {
  return run.provider === "higgsfield" && run.outputType === "video" && run.inputs?.resolution === DRAFT_RESOLUTION;
}

export default function UpscaleDraft({
  generationId,
  project,
  seconds,
  className,
}: {
  generationId: string;
  project: string;
  // The draft's length, for the price (when known)
  seconds: number | null;
  className?: string;
}) {
  const router = useRouter();
  const replicate = useGenerateStore("replicate");
  const [target, setTarget] = useState<(typeof TARGETS)[number]["value"]>("1080p");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const cost = (value: string) =>
    seconds
      ? // Priced like a finished run with these settings
        calculateReplicateCost(MODEL_IDS.TOPAZ_VIDEO, {
          status: "succeeded",
          input: { duration: seconds, target_resolution: value, target_fps: TARGET_FPS },
        })
      : null;

  async function upscale() {
    setOpening(true);
    setError("");
    try {
      const file = await saveRunToLibrary(generationId);
      replicate.loadDraft({
        project,
        model: MODEL_IDS.TOPAZ_VIDEO,
        inputs: { video: file.url, target_resolution: target, target_fps: TARGET_FPS },
      });
      router.push("/replicate");
    } catch (err) {
      setError(errorMessage(err, "Couldn't open the upscaler. Please try again."));
      setOpening(false);
    }
  }

  return (
    <div className={cx("rounded-lg border border-line bg-accent-soft px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Like this draft? Upscale it</p>
          <p className="text-xs text-fg-muted">Same video, sharper. No new generation, so it won&apos;t change.</p>
        </div>

        <div role="radiogroup" aria-label="Upscale to" className="flex gap-1">
          {TARGETS.map((item) => {
            const price = cost(item.value);
            return (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={target === item.value}
                onClick={() => setTarget(item.value)}
                className={cx(
                  "flex flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
                  target === item.value
                    ? "border-accent bg-surface font-semibold text-fg"
                    : "border-line text-fg-muted hover:text-fg",
                )}
              >
                {item.label}
                {price !== null && <span className="font-mono text-[10px] font-normal text-fg-subtle">≈{formatCost(price)}</span>}
              </button>
            );
          })}
        </div>

        <Button variant="primary" size="sm" icon="upscale" onClick={() => void upscale()} disabled={opening}>
          {opening ? "Opening…" : "Upscale"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

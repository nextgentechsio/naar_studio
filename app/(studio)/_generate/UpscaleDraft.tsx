"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGenerateStore } from "@/app/(studio)/_generate/GenerateProvider";
import { Button, cx, formatCost } from "@/app/components/ui/primitives";
import { approxMeteredCostUsd, higherResolutions } from "@/lib/higgsfield/models";

// --------------------------------------------------
// UPSCALE A DRAFT (Higgsfield video at 480p)
//
// Liked the draft? Make it again on the same model at a
// higher resolution, with everything else the same:
// prompt, files, length, ratio, sound. Higgsfield's API
// can't finish the draft video itself (its website's
// Draft Mode isn't offered there; tested), so this is a
// new run of the same settings. The Higgsfield page opens
// with them filled in; Generate there starts it.
// --------------------------------------------------

export const DRAFT_RESOLUTION = "480p";

// A finished Higgsfield video run made at draft size
export function isUpscalableDraft(run: {
  provider?: string | null;
  inputs?: Record<string, unknown> | null;
  outputType?: string | null;
}) {
  return run.provider === "higgsfield" && run.outputType === "video" && run.inputs?.resolution === DRAFT_RESOLUTION;
}

const label = (resolution: string) => (resolution === "4k" ? "4K" : resolution === "2k" ? "2K" : resolution);

export default function UpscaleDraft({
  model,
  project,
  inputs,
  className,
}: {
  model: string;
  project: string;
  // The draft's own inputs
  inputs: Record<string, unknown>;
  className?: string;
}) {
  const router = useRouter();
  const higgsfield = useGenerateStore("higgsfield");
  const targets = higherResolutions(model, DRAFT_RESOLUTION);
  const [target, setTarget] = useState(() => (targets.includes("1080p") ? "1080p" : targets[0]));

  // A model with nothing above 480p
  if (!target) return null;

  function upscale() {
    higgsfield.loadDraft({ project, model, inputs: { ...inputs, resolution: target } });
    router.push("/higgsfield");
  }

  return (
    <div className={cx("rounded-lg border border-line bg-accent-soft px-3 py-2.5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Like this draft? Make it in full quality</p>
          <p className="text-xs text-fg-muted">
            Same model and settings at a higher resolution. It&apos;s a new run, so details can differ from the draft.
          </p>
        </div>

        <div role="radiogroup" aria-label="Resolution" className="flex gap-1">
          {targets.map((value) => {
            const price = approxMeteredCostUsd(model, { ...inputs, resolution: value });
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={target === value}
                onClick={() => setTarget(value)}
                className={cx(
                  "flex flex-col items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
                  target === value
                    ? "border-accent bg-surface font-semibold text-fg"
                    : "border-line text-fg-muted hover:text-fg",
                )}
              >
                {label(value)}
                {price !== null && <span className="font-mono text-[10px] font-normal text-fg-subtle">≈{formatCost(price)}</span>}
              </button>
            );
          })}
        </div>

        <Button variant="primary" size="sm" icon="upscale" onClick={upscale}>
          Upscale
        </Button>
      </div>
    </div>
  );
}

"use client";

import type { ShotRun } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { cx, Spinner } from "@/app/components/ui/primitives";
import { timeAgo } from "../_parts/product-ui";

// --------------------------------------------------
// A SHOT'S VERSIONS: the big preview of one run, and
// the strip of every run (newest first) to pick from
// --------------------------------------------------

export function RunPreview({ run, alt, className }: { run: ShotRun | null; alt: string; className?: string }) {
  return (
    <div className={cx("relative aspect-3/4 overflow-hidden rounded-2xl border border-line bg-sunken", className)}>
      {run?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={run.imageUrl} src={run.imageUrl} alt={alt} className="ui-rise absolute inset-0 h-full w-full object-cover" />
      ) : run?.status === "pending" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-muted" role="status">
          <span className="ui-skeleton absolute inset-0" aria-hidden />
          <Spinner className="relative h-6 w-6" />
          <span className="relative text-sm font-medium">Generating…</span>
          <span className="relative text-xs text-fg-subtle">Usually under a minute</span>
        </div>
      ) : run?.status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <Icon name="alert" size={20} />
          </span>
          <span className="text-sm font-medium text-fg">This version failed</span>
          {run.error && <span className="max-w-xs text-xs text-fg-muted">{run.error}</span>}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-fg-subtle">
          <Icon name="image" size={32} />
          <span className="text-sm">Nothing generated yet</span>
        </div>
      )}
    </div>
  );
}

export function VersionStrip({
  runs,
  selected,
  viewing,
  onView,
}: {
  runs: ShotRun[];
  // The version in use
  selected: string | null;
  // The version shown in the preview
  viewing: string | null;
  onView: (run: ShotRun) => void;
}) {
  if (!runs.length) return null;

  return (
    <ul aria-label="Versions" className="flex gap-2 overflow-x-auto pb-1">
      {runs.map((run, index) => {
        const inUse = run.generationId === selected;
        const shown = run.generationId === viewing;
        const label = `Version ${runs.length - index}${inUse ? " (in use)" : ""}${run.status === "failed" ? " (failed)" : run.status === "pending" ? " (generating)" : ""}`;
        return (
          <li key={run.generationId} className="shrink-0">
            <button
              type="button"
              onClick={() => onView(run)}
              aria-pressed={shown}
              aria-label={label}
              title={[label, run.feedback && `“${run.feedback}”`, timeAgo(run.createdAt)].filter(Boolean).join(" · ")}
              className={cx(
                "relative block aspect-3/4 w-16 overflow-hidden rounded-lg border bg-sunken transition-all duration-200 sm:w-[72px]",
                shown ? "border-accent ring-2 ring-accent/40" : "border-line hover:-translate-y-0.5 hover:border-line-strong",
              )}
            >
              {run.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={run.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              ) : run.status === "pending" ? (
                <span className="absolute inset-0 flex items-center justify-center text-fg-muted">
                  <Spinner />
                </span>
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-danger">
                  <Icon name="alert" size={16} />
                </span>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
                v{runs.length - index}
              </span>
              {inUse && (
                <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
                  <Icon name="check" size={10} />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

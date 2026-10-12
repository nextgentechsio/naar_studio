"use client";

import { Badge, formatCost } from "@/app/components/ui/primitives";
import type { PublicGeneration } from "@/lib/client/data";
import { formatDateTime } from "@/lib/client/format";
import { modelLabel } from "@/lib/model-catalog";
import OutputPreview, { isRunningStatus } from "./OutputPreview";

// One tile in the History grid; opens the detail drawer
export default function GenerationCard({
  generation,
  showUser,
  onOpen,
}: {
  generation: PublicGeneration;
  showUser: boolean;
  onOpen: () => void;
}) {
  const { status } = generation;

  const statusBadge =
    status === "failed" || status === "canceled" ? (
      <Badge tone="danger">{status === "failed" ? "Failed" : "Canceled"}</Badge>
    ) : status === "unknown" ? (
      <Badge tone="warning">Lost</Badge>
    ) : isRunningStatus(status) ? (
      <Badge tone="accent">Running</Badge>
    ) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-square overflow-hidden bg-sunken">
        <OutputPreview
          url={generation.outputUrl}
          contentType={generation.outputContentType}
          status={status}
          variant="thumb"
          expired={generation.outputExpired}
        />

        {statusBadge && (
          <span className="absolute right-2 top-2">{statusBadge}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="truncate text-sm font-semibold text-fg">
          {modelLabel(generation.model)}
        </p>

        <p className="line-clamp-2 min-h-10 text-xs leading-5 text-fg-muted">
          {generation.prompt || (
            <span className="italic text-fg-subtle">No prompt</span>
          )}
        </p>

        {/* Meta truncates; the cost always stays visible */}
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
          <p className="min-w-0 truncate text-[11px] text-fg-subtle">
            {[
              generation.project,
              showUser ? generation.user : null,
              formatDateTime(generation.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <span className="shrink-0 font-mono text-xs text-fg-muted">
            {formatCost(generation.costUsd)}
          </span>
        </div>
      </div>
    </button>
  );
}

export function GenerationCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="aspect-square animate-pulse bg-raised" />
      <div className="space-y-2 p-3.5">
        <div className="h-4 w-2/3 animate-pulse rounded bg-raised" />
        <div className="h-3 w-full animate-pulse rounded bg-raised" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-raised" />
      </div>
    </div>
  );
}

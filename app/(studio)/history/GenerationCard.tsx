"use client";

import { useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { Badge, cx, formatCost } from "@/app/components/ui/primitives";
import type { PublicGeneration } from "@/lib/client/data";
import { formatDateTime } from "@/lib/client/format";
import { modelLabel } from "@/lib/model-catalog";
import OutputPreview, { isRunningStatus } from "./OutputPreview";

// One tile in the History grid; opens the detail drawer.
// For the super admin, hide and delete icons show over
// the image (on hover, or always on touch screens).
export default function GenerationCard({
  generation,
  showUser,
  onOpen,
  onToggleHidden,
  onDelete,
}: {
  generation: PublicGeneration;
  showUser: boolean;
  onOpen: () => void;
  // Given only to the super admin
  onToggleHidden?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { status } = generation;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Finished runs only (the server refuses others too)
  const finished = !isRunningStatus(status);
  const hasActions = finished && (onToggleHidden || onDelete);

  function run(action: () => Promise<void>) {
    setBusy(true);
    action()
      .catch(() => setConfirming(false))
      .finally(() => setBusy(false));
  }

  const statusBadge =
    status === "failed" || status === "canceled" ? (
      <Badge tone="danger">{status === "failed" ? "Failed" : "Canceled"}</Badge>
    ) : status === "unknown" ? (
      <Badge tone="warning">Lost</Badge>
    ) : isRunningStatus(status) ? (
      <Badge tone="accent">Running</Badge>
    ) : null;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

          {/* Only the super admin ever gets hidden runs */}
          {generation.hidden && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              <Icon name="eyeOff" size={12} />
              Hidden
            </span>
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

      {/* Over the image (same square), outside the card's
          button so they're separate controls */}
      {hasActions && (
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
          {confirming ? (
            <div
              role="alertdialog"
              aria-label="Delete this run?"
              className="ui-backdrop pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-t-xl bg-black/75 p-3 text-center backdrop-blur-sm"
            >
              <span className="text-sm font-medium text-white">Delete this run?</span>
              <span className="text-[11px] leading-4 text-white/70">Its cost stays in Expenses.</span>
              <span className="flex gap-1.5">
                <button
                  type="button"
                  autoFocus
                  disabled={busy}
                  onClick={() => onDelete && run(onDelete)}
                  className="rounded-md bg-danger px-3 py-1 text-xs font-medium text-on-danger hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className="rounded-md bg-white/15 px-3 py-1 text-xs font-medium text-white hover:bg-white/25"
                >
                  Keep
                </button>
              </span>
            </div>
          ) : (
            <div
              className={cx(
                "pointer-events-auto absolute bottom-2 right-2 flex gap-1 transition-opacity",
                busy
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              {onToggleHidden && (
                <CardIcon
                  icon={generation.hidden ? "eye" : "eyeOff"}
                  label={generation.hidden ? "Unhide" : "Hide from everyone but you"}
                  disabled={busy}
                  onClick={() => run(onToggleHidden)}
                />
              )}
              {onDelete && (
                <CardIcon
                  icon="trash"
                  label="Delete"
                  danger
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A round icon button over the image, named by its tooltip
function CardIcon({
  icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: "eye" | "eyeOff" | "trash";
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur transition-colors disabled:opacity-60",
        danger ? "hover:bg-danger" : "hover:bg-black/85",
      )}
    >
      <Icon name={icon} size={15} />
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

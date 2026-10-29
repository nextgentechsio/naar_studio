"use client";

import { useState } from "react";
import AddToElementDialog from "@/app/(studio)/elements/AddToElementDialog";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { Badge, cx, formatCost, Spinner } from "@/app/components/ui/primitives";
import type { PublicGeneration } from "@/lib/client/data";
import { formatDateTime } from "@/lib/client/format";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { saveRunToLibrary } from "@/lib/client/library";
import { getOutputType } from "@/lib/client/outputs";
import { modelLabel } from "@/lib/replicate/catalog";
import OutputPreview, { isRunningStatus } from "./OutputPreview";

// One tile in the History grid; opens the detail drawer.
// Over the image (on hover, or always on touch screens):
// "Save to library" and "Add to element" for a finished
// image, video or audio result, and for the super admin,
// hide and delete.
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

  // Its result, when it can go in the library or an element
  const outputType =
    status === "succeeded" && generation.outputUrl && !generation.outputExpired
      ? getOutputType(generation.outputUrl, generation.outputContentType)
      : null;
  const mediaKind = outputType === "file" ? null : outputType;
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState("");
  const [addingToElement, setAddingToElement] = useState(false);

  async function save() {
    setSaving("saving");
    setSaveError("");
    try {
      await saveRunToLibrary(generation.id);
      setSaving("saved");
    } catch (err) {
      logRequestError(err);
      setSaveError(errorMessage(err, "Couldn't save it to the library."));
      setSaving("idle");
    }
  }

  const hasActions = finished && (onToggleHidden || onDelete || mediaKind);

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
    // Lifts on hover, as Elements cards do (the whole tile,
    // so the buttons over the image move with it)
    <div className="group relative transition-transform duration-300 hover:-translate-y-1">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-[border-color,box-shadow] duration-300 hover:border-line-strong group-hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              <span className="text-[11px] leading-4 text-white/70">Its cost is removed from Expenses too.</span>
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
                "absolute inset-x-2 bottom-2 flex gap-1 transition-opacity",
                busy || saving === "saving"
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              {mediaKind && (
                <>
                  <CardIcon
                    icon={saving === "saved" ? "check" : "folder"}
                    label={
                      saveError
                        ? `${saveError} Click to try again.`
                        : saving === "saved"
                          ? "Saved to your library"
                          : saving === "saving"
                            ? "Saving…"
                            : "Save to library"
                    }
                    busy={saving === "saving"}
                    disabled={saving !== "idle"}
                    onClick={() => void save()}
                  />
                  <CardIcon icon="at" label="Add to element" onClick={() => setAddingToElement(true)} />
                </>
              )}
              <span className="flex-1" />
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

      {addingToElement && mediaKind && generation.outputUrl && (
        <AddToElementDialog
          generationId={generation.id}
          kind={mediaKind}
          preview={generation.outputUrl}
          onClose={() => setAddingToElement(false)}
        />
      )}
    </div>
  );
}

// A round icon button over the image, named by its tooltip
function CardIcon({
  icon,
  label,
  danger,
  busy,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  busy?: boolean;
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
        "pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur transition-colors disabled:cursor-default",
        danger ? "hover:bg-danger" : "hover:bg-black/85",
        disabled && !busy && icon !== "check" && "opacity-60",
      )}
    >
      {busy ? <Spinner className="h-3.5 w-3.5 text-white" /> : <Icon name={icon} size={15} />}
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

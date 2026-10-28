"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGenerateStore } from "@/app/(studio)/_components/GenerateProvider";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { Icon } from "@/app/components/ui/Icon";
import {
  Alert,
  Badge,
  Button,
  cx,
  formatCost,
} from "@/app/components/ui/primitives";
import {
  deleteGeneration,
  fetchGeneration,
  setGenerationHidden,
  type GenerationDetail,
  type PublicGeneration,
} from "@/lib/client/data";
import { formatDateTime, formatDuration } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/http";
import { downloadOutput, getOutputType } from "@/lib/client/outputs";
import { MediaDetails } from "@/app/(studio)/replicate/MediaCaption";
import { modelLabel } from "@/lib/model-catalog";
import { canDeleteGenerations, canHideGenerations } from "@/lib/roles";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import OutputPreview, { isRunningStatus } from "./OutputPreview";

// --------------------------------------------------
// GENERATION DETAIL (side drawer)
//
// Opened from the grid or a ?view=<id> link. Shows the
// list data at once, then loads the full record (with
// the inputs "Run again" needs).
// --------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "succeeded") return <Badge tone="success">Succeeded</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "canceled") return <Badge tone="danger">Canceled</Badge>;
  if (status === "unknown") return <Badge tone="warning">Lost</Badge>;
  if (isRunningStatus(status)) return <Badge tone="accent">Running</Badge>;
  return <Badge>{status}</Badge>;
}

export default function GenerationDrawer({
  id,
  preview,
  showUser,
  onClose,
  onHiddenChange,
  onDeleted,
}: {
  id: string;
  // The grid's copy, shown while the full record loads
  preview: PublicGeneration | undefined;
  showUser: boolean;
  onClose: () => void;
  // After the super admin hides or unhides it
  onHiddenChange: (hidden: boolean) => void;
  // After the super admin deletes it
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { projects, currentUser } = useStudio();
  const canDelete = canDeleteGenerations(currentUser);
  const canHide = canHideGenerations(currentUser);
  const [hiding, setHiding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // "Run again" goes back to the provider that ran it
  const replicate = useGenerateStore("replicate");
  const higgsfield = useGenerateStore("higgsfield");

  const [loaded, setLoaded] = useState<{
    id: string;
    detail?: GenerationDetail;
    error?: string;
  }>({ id: "" });
  const [notice, setNotice] = useState("");

  const current = loaded.id === id ? loaded : undefined;
  const generation: PublicGeneration | undefined = current?.detail ?? preview;
  const loadError = current?.error ?? "";

  // Load the full record (state only set in callbacks).
  // Reloaded when the grid sees the status change, so a
  // running generation shows its result when it finishes.
  const listStatus = preview?.status;

  useEffect(() => {
    let cancelled = false;

    fetchGeneration(id)
      .then((detail) => {
        if (!cancelled) setLoaded({ id, detail });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded({
            id,
            error: errorMessage(err, "Unable to load this generation."),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, listStatus]);

  // Focus trap, Escape, scroll lock, focus restore
  const dialogRef = useRef<HTMLElement>(null);
  useDialog(dialogRef, onClose);

  function runAgain() {
    const detail = current?.detail;
    if (!detail) return;

    const isHiggsfield = detail.provider === "higgsfield";
    const { loadDraft, setError: setGenerateError } = isHiggsfield
      ? higgsfield
      : replicate;

    const projectActive = projects.some((item) => item.name === detail.project);

    loadDraft({
      project: projectActive ? detail.project : "",
      model: detail.model,
      inputs: detail.inputs,
    });

    if (!projectActive) {
      setGenerateError(
        `"${detail.project}" is archived or renamed. Choose a project to run this again.`,
      );
    }

    router.push(isHiggsfield ? "/higgsfield" : "/replicate");
  }

  function download() {
    if (!generation?.outputUrl) return;

    setNotice("");
    downloadOutput(
      generation.outputUrl,
      `generation-${generation.predictionId}`,
    ).catch((err) => setNotice(errorMessage(err, "Download failed")));
  }

  function toggleHidden() {
    if (!generation) return;

    const next = !generation.hidden;
    setHiding(true);
    setNotice("");
    setGenerationHidden(id, next)
      .then(() => {
        setLoaded((previous) =>
          previous.id === id && previous.detail
            ? { ...previous, detail: { ...previous.detail, hidden: next } }
            : previous,
        );
        onHiddenChange(next);
        setNotice(
          next
            ? "Hidden. Only you (the super admin) can see this run now."
            : "Visible again to everyone who could see it before.",
        );
      })
      .catch((err) => setNotice(errorMessage(err, "Couldn't change this run.")))
      .finally(() => setHiding(false));
  }

  function remove() {
    setDeleting(true);
    setNotice("");
    deleteGeneration(id)
      .then(onDeleted)
      .catch((err) => {
        setNotice(errorMessage(err, "Couldn't delete this run."));
        setDeleting(false);
        setConfirmDelete(false);
      });
  }

  function copyPrompt() {
    if (!generation?.prompt) return;

    navigator.clipboard
      .writeText(generation.prompt)
      .then(() => setNotice("Prompt copied."))
      .catch(() => setNotice("Couldn't copy the prompt."));
  }

  const details: [string, React.ReactNode][] = generation
    ? [
        ["Project", generation.project],
        ...(showUser
          ? ([["Created by", generation.user]] as [string, React.ReactNode][])
          : []),
        ["Status", <StatusBadge key="status" status={generation.status} />],
        [
          "Cost",
          <span key="cost" className="font-mono">
            {formatCost(generation.costUsd)}
          </span>,
        ],
        ["Run time", formatDuration(generation.predictTime)],
        ...(generation.outputUrl && !generation.outputExpired
          ? ([
              [
                "Output",
                <span key="output" className="tabular-nums">
                  <MediaDetails
                    src={generation.outputUrl}
                    kind={getOutputType(generation.outputUrl, generation.outputContentType)}
                  />
                </span>,
              ],
            ] as [string, React.ReactNode][])
          : []),
        ["Resolution", generation.resolution || "—"],
        ["Aspect ratio", generation.aspectRatio || "—"],
        ["Created", formatDateTime(generation.createdAt)],
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="generation-drawer-title"
    >
      <button
        type="button"
        aria-label="Close details"
        tabIndex={-1}
        className="ui-backdrop absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        ref={dialogRef}
        className="relative flex h-full w-full max-w-xl flex-col border-l glass"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id="generation-drawer-title"
              className="truncate text-base font-semibold text-fg"
            >
              {generation ? modelLabel(generation.model) : "Generation"}
            </h2>
            {generation &&
              modelLabel(generation.model) !== generation.model && (
                <p className="truncate font-mono text-[11px] text-fg-subtle">
                  {generation.model}
                </p>
              )}
          </div>

          <Button
            data-autofocus
            size="sm"
            variant="ghost"
            icon="close"
            aria-label="Close details"
            onClick={onClose}
          />
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {!generation ? (
            loadError ? (
              <Alert>{loadError}</Alert>
            ) : (
              <div className="aspect-square animate-pulse rounded-lg bg-raised" />
            )
          ) : (
            <>
              <div className="relative flex min-h-48 items-center justify-center overflow-hidden rounded-lg border border-line bg-black">
                <OutputPreview
                  key={generation.outputUrl ?? "none"}
                  url={generation.outputUrl}
                  contentType={generation.outputContentType}
                  status={generation.status}
                  variant="full"
                  expired={generation.outputExpired}
                />
              </div>

              {generation.hidden && (
                <p className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">
                  <Icon name="eyeOff" size={14} />
                  Hidden: only you can see this run. Its cost still counts in Expenses.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon="sparkles"
                  onClick={runAgain}
                  disabled={!current?.detail}
                  title={
                    current?.detail
                      ? "Open Generate with the same project, model and settings"
                      : "Loading settings…"
                  }
                >
                  Run again
                </Button>

                {generation.outputUrl && (
                  <Button icon="download" onClick={download}>
                    Download
                  </Button>
                )}

                {generation.prompt && (
                  <Button variant="ghost" icon="copy" onClick={copyPrompt}>
                    Copy prompt
                  </Button>
                )}

                {canHide && !confirmDelete && (
                  <Button
                    variant="ghost"
                    icon={generation.hidden ? "eye" : "eyeOff"}
                    aria-label={generation.hidden ? "Unhide" : "Hide"}
                    className="ml-auto w-10 px-0"
                    disabled={hiding || isRunningStatus(generation.status)}
                    title={
                      isRunningStatus(generation.status)
                        ? "It can be hidden once it has finished"
                        : generation.hidden
                          ? "Unhide: show it again to its owner and admins"
                          : "Hide from everyone but you"
                    }
                    onClick={toggleHidden}
                  />
                )}

                {canDelete && !confirmDelete && (
                  <Button
                    variant="ghost"
                    icon="trash"
                    aria-label="Delete"
                    className={cx(!canHide && "ml-auto", "w-10 px-0 text-danger hover:text-danger")}
                    disabled={isRunningStatus(generation.status)}
                    title={
                      isRunningStatus(generation.status)
                        ? "It can be deleted once it has finished"
                        : "Delete from History"
                    }
                    onClick={() => setConfirmDelete(true)}
                  />
                )}
              </div>

              {confirmDelete && (
                <div
                  role="alertdialog"
                  aria-label="Delete this run?"
                  className="ui-rise rounded-lg border border-danger/40 bg-danger/10 p-3"
                >
                  <p className="text-sm font-medium text-fg">Delete this run from History?</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Its saved output is removed for everyone and can&apos;t be
                    recovered. Its cost is removed from Expenses too.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      autoFocus
                      disabled={deleting}
                      onClick={remove}
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep
                    </Button>
                  </div>
                </div>
              )}

              {notice && (
                <p className="text-xs text-fg-muted" role="status">
                  {notice}
                </p>
              )}

              {generation.error && (
                <Alert>
                  <p className="font-medium">The model reported an error</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    {generation.error}
                  </p>
                </Alert>
              )}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  Prompt
                </h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-fg">
                  {generation.prompt || (
                    <span className="italic text-fg-subtle">No prompt</span>
                  )}
                </p>
              </section>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-sunken p-4 text-sm">
                {details.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 truncate text-fg">{value}</dd>
                  </div>
                ))}
              </dl>

              <p className="break-all font-mono text-[11px] text-fg-subtle">
                ID {generation.predictionId}
              </p>

              {loadError && <Alert tone="warning">{loadError}</Alert>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

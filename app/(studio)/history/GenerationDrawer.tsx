"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import {
  Alert,
  Badge,
  Button,
  formatCost,
} from "@/app/components/ui/primitives";
import {
  fetchGeneration,
  type GenerationDetail,
  type PublicGeneration,
} from "@/lib/client/data";
import { formatDateTime, formatDuration } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/http";
import { downloadOutput } from "@/lib/client/outputs";
import { modelLabel } from "@/lib/model-catalog";
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
}: {
  id: string;
  // The grid's copy, shown while the full record loads
  preview: PublicGeneration | undefined;
  showUser: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { projects } = useStudio();
  const { loadDraft, setError: setGenerateError } = useGenerate();

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

    router.push("/generate");
  }

  function download() {
    if (!generation?.outputUrl) return;

    setNotice("");
    downloadOutput(
      generation.outputUrl,
      `generation-${generation.predictionId}`,
    ).catch((err) => setNotice(errorMessage(err, "Download failed")));
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
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <aside
        ref={dialogRef}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-xl"
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
              </div>

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

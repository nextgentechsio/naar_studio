"use client";

import { useState } from "react";
import { catalogueApi } from "@/lib/client/catalogue";
import { Alert, Button, EmptyState, Spinner } from "@/app/components/ui/primitives";
import { Modal } from "@/app/components/ui/Modal";
import { shotState } from "../_parts/product-ui";
import FeedbackBox from "./FeedbackBox";
import type { StepProps } from "./types";
import { RunPreview, VersionStrip } from "./Versions";

// --------------------------------------------------
// STEP 4: INITIAL LOOK
//
// One image of the garment on the model; try again with
// feedback until it's right, pick the version to keep,
// then approve to shoot the rest of the template from it.
// --------------------------------------------------

export default function InitialLookStep({ product, act, goTo }: StepProps) {
  const [feedback, setFeedback] = useState("");
  // The version in the preview; null: the newest that matters
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  const shot = product.shots[0];
  if (!shot) {
    return (
      <div className="glass rounded-2xl border">
        <EmptyState
          icon="gridMedium"
          title="Choose a template first"
          description="The template's first shot is the initial look."
          action={
            <Button variant="primary" onClick={() => goTo(2)}>
              Choose a template
            </Button>
          }
        />
      </div>
    );
  }

  const state = shotState(shot);
  const locked = product.status === "shooting" || product.status === "done";
  const view =
    shot.runs.find((run) => run.generationId === viewId) ?? (state.pending ? state.latest : (state.selected ?? state.latest));
  const missing = !product.inputs.front ? "Upload the garment's front photo first." : null;
  const rest = product.shots.length - 1;

  async function generate() {
    setStarting(true);
    const failed = await act(() => catalogueApi.generate(product.id, feedback.trim()), "Couldn't start the initial look.");
    setStarting(false);
    if (!failed) {
      setFeedback("");
      setViewId(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-3">
        <RunPreview run={view} alt={`${product.name}, initial look`} className="mx-auto w-full max-w-md lg:max-w-none" />
        <VersionStrip
          runs={shot.runs}
          selected={shot.selected}
          viewing={view?.generationId ?? null}
          onView={(run) => {
            setViewId(run.generationId);
            if (run.status === "succeeded" && run.generationId !== shot.selected && !locked) {
              void act(() => catalogueApi.select(product.id, shot.shotId, run.generationId), "Couldn't use that version.");
            }
          }}
        />
      </div>

      <div className="space-y-4">
        <section className="glass space-y-4 rounded-2xl border p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-fg">{shot.label}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {locked
                ? "Approved. Every other shot was taken from this look."
                : "Get one look right first: the garment, the model and the styling. Every other shot follows it."}
            </p>
          </div>

          {locked ? (
            <Alert tone="success">
              The initial look is locked. To change it, regenerate it from{" "}
              <button type="button" onClick={() => goTo(5)} className="font-medium underline">
                Shots
              </button>
              .
            </Alert>
          ) : (
            <>
              {missing && <Alert tone="warning">{missing}</Alert>}
              {shot.runs.length > 0 && <FeedbackBox value={feedback} onChange={setFeedback} disabled={state.pending} />}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={shot.selected ? "secondary" : "primary"}
                  icon={state.pending || starting ? undefined : "sparkles"}
                  disabled={state.pending || starting || Boolean(missing)}
                  onClick={() => void generate()}
                >
                  {(state.pending || starting) && <Spinner />}
                  {state.pending ? "Generating…" : shot.runs.length ? "Try again" : "Generate initial look"}
                </Button>
              </div>
            </>
          )}
        </section>

        {!locked && (
          <section className="glass space-y-3 rounded-2xl border p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-fg">Happy with it?</h2>
            <p className="text-xs text-fg-muted">
              {shot.selected
                ? `Approving locks this look and shoots the other ${rest} shot${rest === 1 ? "" : "s"} of the template from it.`
                : "Generate a look and choose the version you like (tap it in the strip) to approve it."}
            </p>
            <Button
              variant="primary"
              icon="check"
              disabled={!shot.selected || state.pending}
              onClick={() => setConfirming(true)}
            >
              Approve &amp; shoot all {product.shots.length} shots
            </Button>
          </section>
        )}
      </div>

      {confirming && (
        <ApproveDialog
          shots={rest}
          project={product.project.name}
          onApprove={async () => {
            const failed = await act(() => catalogueApi.approve(product.id), "Couldn't approve the initial look.");
            if (!failed) goTo(5);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function ApproveDialog({
  shots,
  project,
  onApprove,
  onClose,
}: {
  shots: number;
  project: string;
  onApprove: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Approve the initial look?" size="sm" onClose={onClose}>
      {(close) => (
        <>
          <div className="space-y-3 px-5 pb-4 pt-1 text-sm text-fg-muted">
            <p>
              This locks the look and the template, then shoots the other {shots} shot{shots === 1 ? "" : "s"} from it.
            </p>
            <p className="text-xs text-fg-subtle">The images go to {project}. You can regenerate any shot later.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button onClick={close} disabled={busy}>
              Not yet
            </Button>
            <Button
              variant="primary"
              icon={busy ? undefined : "check"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                // Closed either way: the workspace shows why it failed
                await onApprove();
                close();
              }}
            >
              {busy && <Spinner />}
              {busy ? "Starting shots…" : "Approve & shoot"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

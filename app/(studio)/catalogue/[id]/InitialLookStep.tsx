"use client";

import { useState } from "react";
import { catalogueApi } from "@/lib/client/catalogue";
import { Alert, Button, EmptyState, Spinner } from "@/app/components/ui/primitives";
import { shotState } from "../_parts/product-ui";
import CropDialog from "./CropDialog";
import FeedbackBox from "./FeedbackBox";
import ShotPlanDialog from "./ShotPlanDialog";
import type { StepProps } from "./types";
import { RunPreview, useImageRatio, VersionStrip } from "./Versions";

// --------------------------------------------------
// STEP 4: INITIAL LOOK
//
// One image of the garment on the model; try again with
// feedback until it's right, pick the version to keep,
// then approve to shoot the rest of the template from it.
// --------------------------------------------------

export default function InitialLookStep({ product, library, act, goTo }: StepProps) {
  const [feedback, setFeedback] = useState("");
  // The version in the preview; null: the newest that matters
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cropping, setCropping] = useState<string | null>(null);
  const { ratioOf, setRatio } = useImageRatio();

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
      {/* The preview fits the screen; on wide screens the
          versions run down beside it */}
      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start lg:justify-end">
        <RunPreview
          run={view}
          initial
          alt={`${product.name}, initial look`}
          fit={24}
          className="lg:mx-0 lg:min-w-0"
          imageRatio={ratioOf(view?.imageUrl)}
          onRatio={setRatio}
          onCrop={view ? () => setCropping(view.generationId) : undefined}
        />
        <VersionStrip
          runs={shot.runs}
          selected={shot.selected}
          viewing={view?.generationId ?? null}
          className="lg:max-h-[calc(100dvh-22rem)] lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0 lg:pr-1"
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
                ? `Approving locks this look. Next you choose a pose and background for each of the other ${rest} shot${rest === 1 ? "" : "s"}, then they're shot from it.`
                : "Generate a look and choose the version you like (tap it in the strip) to approve it."}
            </p>
            <Button
              variant="primary"
              icon="check"
              disabled={!shot.selected || state.pending}
              onClick={() => setConfirming(true)}
            >
              Approve &amp; plan {rest} shot{rest === 1 ? "" : "s"}
            </Button>
          </section>
        )}
      </div>

      {cropping && (() => {
        const run = shot.runs.find((item) => item.generationId === cropping);
        return run?.imageUrl ? (
          <CropDialog
            src={run.imageUrl}
            crop={run.crop}
            imageRatio={ratioOf(run.imageUrl)}
            onSave={(crop) =>
              act(
                () => catalogueApi.crop(product.id, { shotId: shot.shotId, generationId: run.generationId, crop }),
                "Couldn't save the crop.",
              )
            }
            onClose={() => setCropping(null)}
          />
        ) : null;
      })()}

      {confirming && (
        <ShotPlanDialog
          product={product}
          assets={library?.assets ?? null}
          initialUrl={shot.runs.find((run) => run.generationId === shot.selected)?.imageUrl ?? null}
          onApprove={async (plan) => {
            const failed = await act(() => catalogueApi.approve(product.id, plan), "Couldn't approve the initial look.");
            if (!failed) goTo(5);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

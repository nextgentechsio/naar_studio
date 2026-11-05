"use client";

import { useState } from "react";
import type { PublicProduct } from "@/lib/catalogue/shared";
import { catalogueApi, downloadImage, type Library } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Modal } from "@/app/components/ui/Modal";
import { Button, Field, inputClass, Spinner } from "@/app/components/ui/primitives";
import { assetsOf, shotState } from "../_parts/product-ui";
import FeedbackBox from "./FeedbackBox";
import type { StepProps } from "./types";
import { RunPreview, VersionStrip } from "./Versions";

// --------------------------------------------------
// ONE SHOT, LARGE (window)
//
// Its versions (pick the one to use), download, and
// regenerate with feedback and an optional pose or
// background just for this shot. Follows the live
// product, so a new version appears as it finishes.
// --------------------------------------------------

export function shotFileName(product: PublicProduct, label: string) {
  return `${product.sku || product.name}-${label}`;
}

export default function ShotViewer({
  product,
  library,
  shotId,
  act,
  onClose,
}: {
  product: PublicProduct;
  library: Library | null;
  shotId: string;
  act: StepProps["act"];
  onClose: () => void;
}) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [poseId, setPoseId] = useState("");
  const [backgroundId, setBackgroundId] = useState("");
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const shot = product.shots.find((item) => item.shotId === shotId);
  const state = shot ? shotState(shot) : null;
  const view =
    shot && state
      ? (shot.runs.find((run) => run.generationId === viewId) ??
        (state.pending ? state.latest : (state.selected ?? state.latest)))
      : null;
  const poses = assetsOf(library?.assets, "pose", product.gender);
  const backgrounds = assetsOf(library?.assets, "background", product.gender);

  async function regenerate() {
    setStarting(true);
    setError("");
    const failed = await act(
      () =>
        catalogueApi.regenerate(product.id, {
          shotId,
          feedback: feedback.trim(),
          poseId: poseId || null,
          backgroundId: backgroundId || null,
        }),
      "Couldn't regenerate the shot.",
    );
    setStarting(false);
    if (failed) setError(failed);
    else {
      setFeedback("");
      setViewId(null);
    }
  }

  async function download(url: string) {
    setDownloading(true);
    setError("");
    try {
      await downloadImage(url, shotFileName(product, shot?.label ?? shotId));
    } catch (err) {
      setError(errorMessage(err, "Couldn't download the image."));
    } finally {
      setDownloading(false);
    }
  }

  const busy = Boolean(state?.pending) || starting;

  return (
    <Modal title={shot?.label ?? "Shot"} subtitle={product.name} size="xl" onClose={onClose}>
      {() =>
        !shot || !state ? (
          <p className="px-5 pb-5 text-sm text-fg-muted">This shot is no longer in the product.</p>
        ) : (
          <div className="grid min-h-0 gap-5 overflow-y-auto px-5 pb-5 pt-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <RunPreview run={view} alt={`${product.name}, ${shot.label}`} />
              <VersionStrip
                runs={shot.runs}
                selected={shot.selected}
                viewing={view?.generationId ?? null}
                onView={(run) => setViewId(run.generationId)}
              />
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {view?.status === "succeeded" && view.generationId !== shot.selected && (
                  <Button
                    variant="primary"
                    icon="check"
                    onClick={async () => {
                      setError("");
                      const failed = await act(
                        () => catalogueApi.select(product.id, shotId, view.generationId),
                        "Couldn't use that version.",
                      );
                      if (failed) setError(failed);
                    }}
                  >
                    Use this version
                  </Button>
                )}
                {view?.imageUrl && (
                  <Button icon={downloading ? undefined : "download"} disabled={downloading} onClick={() => void download(view.imageUrl!)}>
                    {downloading && <Spinner />}
                    Download
                  </Button>
                )}
              </div>
              {view?.feedback && (
                <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">
                  Feedback for this version: &ldquo;{view.feedback}&rdquo;
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}

              <section className="space-y-3 border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-fg">Regenerate</h3>
                <FeedbackBox value={feedback} onChange={setFeedback} disabled={busy} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Pose">
                    {(props) => (
                      <select
                        {...props}
                        value={poseId}
                        disabled={busy}
                        onChange={(event) => setPoseId(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">As before</option>
                        {poses.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Background">
                    {(props) => (
                      <select
                        {...props}
                        value={backgroundId}
                        disabled={busy}
                        onChange={(event) => setBackgroundId(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">As before</option>
                        {backgrounds.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" icon={busy ? undefined : "sparkles"} disabled={busy} onClick={() => void regenerate()}>
                    {busy && <Spinner />}
                    {state.pending ? "Generating…" : "Regenerate"}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        )
      }
    </Modal>
  );
}

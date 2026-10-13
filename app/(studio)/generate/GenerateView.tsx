"use client";

import { useEffect, useRef, useState } from "react";
import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import { Icon } from "@/app/components/ui/Icon";
import {
  Alert,
  Badge,
  Button,
  cx,
  EmptyState,
  Field,
  formatCost,
  inputClass,
  Spinner,
  textareaClass,
} from "@/app/components/ui/primitives";
import { errorMessage } from "@/lib/client/http";
import {
  downloadOutput,
  getOutputType,
  getOutputUrls,
} from "@/lib/client/outputs";
import {
  findCatalogModel,
  KIND_LABELS,
  MODEL_CATALOG,
} from "@/lib/model-catalog";
import { calculateReplicateCost } from "@/lib/replicate-cost";
import { canManageProjects } from "@/lib/roles";
import {
  ASPECT_RATIOS,
  buildGenerationInputs,
  fieldGroup,
  orderSchemaFields,
  StableTextArea,
} from "./fields";
import ModelBrowserDialog from "./ModelBrowserDialog";
import SchemaField from "./SchemaField";

// --------------------------------------------------
// GENERATE PAGE
//
// One screen, two panels, no page scroll on laptops and
// up: Inputs on the left (project + model, prompt,
// settings, and a pinned cost + Generate bar) and the
// Output on the right. Only the prompt grows to fill
// the space and scrolls inside itself; long settings
// scroll inside the Inputs panel. Phones stack the two
// panels and scroll normally. State lives in
// GenerateProvider (studio layout).
// --------------------------------------------------

// Model dropdown groups, in this order
const MODEL_KINDS = ["image", "video", "upscale"] as const;

export default function GenerateView() {
  const { currentUser, projects: projectList } = useStudio();

  const {
    project,
    setProject,
    model,
    chooseModel,
    schema,
    schemaLoading,
    inputs,
    updateInput,
    uploading,
    generating,
    result,
    error,
    setError,
    generate,
  } = useGenerate();

  const projects = projectList.map((item) => item.name);

  const [browsing, setBrowsing] = useState(false);

  // Phones (stacked panels): bring the output into view
  // when a run starts. On wider screens it's already there.
  const outputRef = useRef<HTMLElement>(null);
  const runId = result?.prediction.id;

  useEffect(() => {
    if (runId) {
      outputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [runId]);

  const catalogModel = model ? findCatalogModel(model) : undefined;

  const has = (key: string) =>
    Object.prototype.hasOwnProperty.call(schema, key);

  const hasPrompt = has("prompt");

  const hasAspectRatio =
    model === "google/nano-banana-2" || has("aspect_ratio");

  const hasResolution = model === "google/nano-banana-2" || has("resolution");

  const aspectRatioOptions = schema.aspect_ratio?.enum ?? ASPECT_RATIOS;

  const resolutionOptions = schema.resolution?.enum ?? ["1K", "2K", "4K"];

  const orderedFields = orderSchemaFields(schema);

  const mediaFields = orderedFields.filter(
    ([key, field]) => fieldGroup(key, field) === "media",
  );
  const mainFields = orderedFields.filter(
    ([key, field]) => fieldGroup(key, field) === "main",
  );
  const advancedFields = orderedFields.filter(
    ([key, field]) => fieldGroup(key, field) === "advanced",
  );

  // ---------- Cost preview ----------
  // Same price table the server uses after the run;
  // priced from exactly the inputs Generate will send.

  let estimate: number | null = null;

  if (model && catalogModel && !schemaLoading) {
    try {
      estimate = calculateReplicateCost(model, {
        status: "succeeded",
        input: buildGenerationInputs(inputs),
      });
    } catch {
      estimate = null;
    }
  }

  const estimateDetail = [
    inputs.resolution ? String(inputs.resolution) : "",
    inputs.duration ? `${inputs.duration}s` : "",
    inputs.quality ? `${inputs.quality} quality` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // ---------- Readiness ----------

  const uploadsInFlight = Object.values(uploading).some((count) => count > 0);

  const missing = [
    !project && "choose a project",
    !model && "choose a model",
    uploadsInFlight && "wait for uploads to finish",
  ].filter(Boolean) as string[];

  const canGenerate = missing.length === 0 && !generating && !schemaLoading;

  // ---------- Output ----------

  const status = result?.prediction.status;
  const isRunning =
    generating ||
    status === "starting" ||
    status === "processing" ||
    status === "queued";

  const outputUrls = getOutputUrls(result?.prediction.output);

  const predictTime = result?.prediction.metrics?.predict_time;

  const projectHint = !projects.length
    ? canManageProjects(currentUser)
      ? "No projects yet. Create one in Admin › Projects."
      : "No projects yet. Ask an admin to create one."
    : undefined;

  function download(url: string, filename: string) {
    downloadOutput(url, filename).catch((err) => {
      console.error("DOWNLOAD ERROR:", err);
      setError(errorMessage(err, "Download failed"));
    });
  }

  const panelClass =
    "flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card lg:min-h-0";
  const smallLabel = "mb-1.5 block text-xs font-medium text-fg-muted";

  return (
    <>
      <h1 className="sr-only">Generate</h1>

      {/* Fills the screen below the top bar on laptops and
          up: 3.5rem top bar + 3rem page padding */}
      <div className="flex flex-col gap-4 lg:grid lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-2 lg:gap-5">
        {/* ================= INPUTS ================= */}
        <section aria-label="Inputs" className={panelClass}>
          {/* Project + model */}
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="generate-project" className={smallLabel}>
                Project{" "}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="flex items-center gap-2">
                <ProjectAvatar
                  name={project}
                  imageUrl={
                    projectList.find((item) => item.name === project)?.imageUrl
                  }
                  size={36}
                />
                <select
                  id="generate-project"
                  required
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                  className={cx(
                    inputClass,
                    "min-w-0",
                    !project && "text-fg-subtle",
                  )}
                >
                  <option value="" disabled>
                    Select project
                  </option>
                  {projects.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              {/* Lined up under the select (avatar 36px + gap) */}
              {projectHint && (
                <p className="mt-1.5 pl-11 text-xs text-warning">
                  {projectHint}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label htmlFor="generate-model" className={smallLabel}>
                Model{" "}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                    model
                      ? "border-accent bg-accent text-on-accent"
                      : "border-line bg-sunken text-fg-subtle",
                  )}
                  aria-hidden
                >
                  <Icon
                    name={
                      catalogModel
                        ? catalogModel.kind === "upscale"
                          ? "upscale"
                          : catalogModel.kind
                        : "sparkles"
                    }
                    size={16}
                  />
                </span>
                <select
                  id="generate-model"
                  required
                  value={model}
                  onChange={(event) => chooseModel(event.target.value)}
                  className={cx(
                    inputClass,
                    "min-w-0",
                    !model && "text-fg-subtle",
                  )}
                >
                  <option value="" disabled>
                    Select model
                  </option>
                  {MODEL_KINDS.map((kind) => (
                    <optgroup key={kind} label={KIND_LABELS[kind]}>
                      {MODEL_CATALOG.filter((item) => item.kind === kind).map(
                        (item) => (
                          <option key={item.id} value={item.id}>
                            {item.label} · {item.priceHint}
                          </option>
                        ),
                      )}
                    </optgroup>
                  ))}
                  {/* Picked in "Browse all models" */}
                  {model && !catalogModel && (
                    <optgroup label="Other Replicate model">
                      <option value={model}>{model} · unpriced</option>
                    </optgroup>
                  )}
                </select>
              </div>
              {/* Under the select: what the chosen model is, and
                  the way to any other Replicate model */}
              <div className="mt-1.5 flex min-w-0 items-center justify-between gap-3 pl-11 text-xs">
                <p
                  className={cx(
                    "min-w-0 truncate",
                    catalogModel ? "text-fg-subtle" : "text-warning",
                  )}
                  title={
                    catalogModel
                      ? `${catalogModel.vendor} · ${catalogModel.summary}`
                      : model
                        ? "Replicate doesn't report this model's cost, so its runs are recorded as unpriced in Expenses."
                        : undefined
                  }
                >
                  {catalogModel
                    ? `${catalogModel.vendor} · ${catalogModel.summary}`
                    : model
                      ? "Unpriced: no cost on file"
                      : ""}
                </p>
                <button
                  type="button"
                  onClick={() => setBrowsing(true)}
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline"
                >
                  <Icon name="search" size={12} />
                  Browse all models
                </button>
              </div>
            </div>
          </div>

          {/* Settings: the prompt takes all spare height */}
          <div className="@container flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {!model ? (
              <EmptyState
                compact
                icon="sparkles"
                title="Choose a model"
                description="Its prompt and settings appear here."
              />
            ) : schemaLoading ? (
              <div
                className="flex flex-1 flex-col gap-3"
                aria-busy="true"
                aria-label="Loading model settings"
              >
                <div className="min-h-32 flex-1 animate-pulse rounded-lg bg-raised" />
                <div className="h-10 w-2/3 animate-pulse rounded-lg bg-raised" />
              </div>
            ) : (
              // Remount per model so uncontrolled text areas
              // reset with the new defaults
              <div key={model} className="flex min-h-0 flex-1 flex-col gap-3">
                {hasPrompt && (
                  <Field
                    label="Prompt"
                    required
                    className="flex min-h-28 flex-1 flex-col"
                  >
                    {(control) => (
                      <StableTextArea
                        {...control}
                        rows={7}
                        value={String(inputs.prompt ?? "")}
                        onChange={(next) => updateInput("prompt", next)}
                        placeholder="Describe what you want to create. Be specific about subject, style and lighting…"
                        className={cx(
                          textareaClass,
                          "min-h-0 flex-1 resize-none",
                        )}
                      />
                    )}
                  </Field>
                )}

                {mediaFields.length > 0 && (
                  <div
                    className={cx(
                      "grid shrink-0 gap-3",
                      mediaFields.length > 1 && "grid-cols-2",
                    )}
                  >
                    {mediaFields.map(([key, field]) => (
                      <SchemaField key={key} fieldKey={key} field={field} />
                    ))}
                  </div>
                )}

                {/* Every short setting in one grid: 3 across when
                    the panel is wide enough, else 2 */}
                {(hasAspectRatio || hasResolution || mainFields.length > 0) && (
                  <div className="grid shrink-0 grid-cols-2 gap-3 @md:grid-cols-3">
                    {hasAspectRatio && (
                      <Field label="Aspect ratio">
                        {(control) => (
                          <select
                            {...control}
                            value={String(
                              inputs.aspect_ratio ?? aspectRatioOptions[0],
                            )}
                            onChange={(event) =>
                              updateInput("aspect_ratio", event.target.value)
                            }
                            className={inputClass}
                          >
                            {aspectRatioOptions.map((ratio) => (
                              <option key={ratio} value={ratio}>
                                {ratio === "match_input_image"
                                  ? "Match input image"
                                  : ratio}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}

                    {hasResolution && (
                      <Field label="Resolution">
                        {(control) => (
                          <select
                            {...control}
                            value={String(
                              inputs.resolution ?? resolutionOptions[0],
                            )}
                            onChange={(event) =>
                              updateInput("resolution", event.target.value)
                            }
                            className={inputClass}
                          >
                            {resolutionOptions.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    )}
                    {mainFields.map(([key, field]) => (
                      <div
                        key={key}
                        className={cx(
                          // Long text spans the whole row
                          /description|negative/i.test(key) && "col-span-full",
                        )}
                      >
                        <SchemaField fieldKey={key} field={field} />
                      </div>
                    ))}
                  </div>
                )}

                {advancedFields.length > 0 && (
                  <details
                    className="group shrink-0 rounded-lg border border-line"
                    // Once open (after the height animation), make
                    // sure the new options are in view
                    onToggle={(event) => {
                      const details = event.currentTarget;
                      if (!details.open) return;
                      setTimeout(
                        () =>
                          details.scrollIntoView({
                            block: "nearest",
                            behavior: "smooth",
                          }),
                        260,
                      );
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-sm font-medium text-fg-muted hover:text-fg">
                      <span>
                        Advanced settings
                        <span className="ml-1.5 text-fg-subtle">
                          ({advancedFields.length})
                        </span>
                      </span>
                      <Icon
                        name="chevronDown"
                        size={16}
                        className="transition-transform duration-200 group-open:rotate-180"
                      />
                    </summary>
                    <div className="space-y-4 border-t border-line p-3.5">
                      {advancedFields.map(([key, field]) => (
                        <SchemaField key={key} fieldKey={key} field={field} />
                      ))}
                    </div>
                  </details>
                )}

                {!hasPrompt &&
                  !hasAspectRatio &&
                  !hasResolution &&
                  orderedFields.length === 0 && (
                    <p className="text-sm text-fg-subtle">
                      This model has no settings.
                    </p>
                  )}
              </div>
            )}
          </div>

          {/* Run: always visible at the bottom of the panel */}
          <div className="border-t border-line p-4">
            {error && (
              <div className="mb-3">
                <Alert>{error}</Alert>
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0" aria-live="polite">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
                  Estimated cost
                </p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  {!model ? (
                    <span className="text-sm text-fg-muted">—</span>
                  ) : !catalogModel ? (
                    <span className="text-base font-semibold text-warning">
                      Unpriced
                    </span>
                  ) : schemaLoading ? (
                    <span className="inline-block h-7 w-24 animate-pulse rounded-md bg-raised" />
                  ) : estimate !== null ? (
                    <>
                      <span className="font-mono text-2xl font-semibold tracking-tight text-fg">
                        ≈ {formatCost(estimate)}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        per run{estimateDetail ? ` · ${estimateDetail}` : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-base font-semibold text-fg">
                        {catalogModel.priceHint}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        depends on output size
                      </span>
                    </>
                  )}
                </div>
                {missing.length > 0 && !generating && (
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    To continue, {missing.join(" and ")}.
                  </p>
                )}
              </div>

              <Button
                variant="primary"
                size="lg"
                icon={generating ? undefined : "sparkles"}
                onClick={generate}
                disabled={!canGenerate}
                className="shrink-0 sm:w-44"
              >
                {generating ? (
                  <>
                    <Spinner /> Starting…
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
          </div>
        </section>

        {/* ================= OUTPUT ================= */}
        <section
          ref={outputRef}
          aria-label="Output"
          className={cx(
            panelClass,
            "min-h-[24rem] scroll-mt-20 overflow-hidden",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Output</h2>
              {status && (
                <Badge
                  tone={
                    status === "succeeded"
                      ? "success"
                      : status === "failed" || status === "canceled"
                        ? "danger"
                        : status === "unknown"
                          ? "warning"
                          : "accent"
                  }
                >
                  {status}
                </Badge>
              )}
            </div>

            {status === "succeeded" && outputUrls.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {outputUrls.map((url, index) => (
                  <Button
                    key={`download-${index}`}
                    variant="secondary"
                    size="sm"
                    icon="download"
                    onClick={() =>
                      download(
                        url,
                        outputUrls.length > 1
                          ? `generation-${result!.prediction.id}-${index + 1}`
                          : `generation-${result!.prediction.id}`,
                      )
                    }
                  >
                    Download{outputUrls.length > 1 ? ` ${index + 1}` : ""}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* The result fills whatever space the panel has */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center bg-sunken/60 p-4"
            aria-live="polite"
          >
            {isRunning ? (
              <div className="flex flex-col items-center text-center">
                <Spinner className="h-6 w-6 text-accent" />
                <p className="mt-4 text-sm font-medium text-fg">Generating…</p>
                <p className="mt-1 max-w-xs text-xs text-fg-subtle">
                  Video can take a few minutes. You can leave this page; the
                  result is saved to History.
                </p>
              </div>
            ) : status === "succeeded" && outputUrls.length > 0 ? (
              <div
                className={cx(
                  "grid h-full w-full gap-3",
                  outputUrls.length > 1 && "grid-cols-2 auto-rows-fr",
                )}
              >
                {outputUrls.map((url, index) => {
                  const outputType = getOutputType(url);

                  return (
                    <div
                      key={`${url}-${index}`}
                      className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg"
                    >
                      {outputType === "video" ? (
                        <video
                          src={url}
                          className="h-full w-full object-contain"
                          controls
                          muted
                          playsInline
                        />
                      ) : outputType === "audio" ? (
                        <audio src={url} controls className="w-full" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={`Generated output ${index + 1}`}
                          className="h-full w-full object-contain"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : status === "unknown" ? (
              // Polling gave up; the server still finishes the
              // run and records it in History
              <Alert tone="warning">
                <p className="font-medium">Still waiting on Replicate</p>
                <p className="mt-0.5 text-xs opacity-90">
                  We stopped checking here, but the run is tracked: its result
                  and cost will appear in History.
                </p>
              </Alert>
            ) : status === "failed" || status === "canceled" ? (
              <Alert>
                <p className="font-medium">Generation {status}</p>
                <p className="mt-0.5 text-xs opacity-90">
                  {result?.prediction.error ||
                    "The model couldn't complete this run. Failed runs aren't added to Expenses."}
                </p>
              </Alert>
            ) : (
              <EmptyState
                compact
                icon="image"
                title="Nothing generated yet"
                description="Your result will appear here. It's also saved to History."
              />
            )}
          </div>

          {status === "succeeded" && outputUrls.length > 0 && (
            <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-4 py-2.5 text-xs">
              <div className="flex gap-1.5">
                <dt className="text-fg-subtle">Cost</dt>
                <dd className="font-mono font-medium text-fg">
                  {formatCost(result?.costUsd)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-fg-subtle">Run time</dt>
                <dd className="font-medium text-fg">
                  {typeof predictTime === "number"
                    ? `${predictTime.toFixed(1)}s`
                    : "—"}
                </dd>
              </div>
              <div className="text-fg-subtle">Saved to History</div>
            </dl>
          )}
        </section>
      </div>

      {browsing && <ModelBrowserDialog onClose={() => setBrowsing(false)} />}
    </>
  );
}

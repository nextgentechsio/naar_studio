"use client";

import { useEffect, useRef } from "react";
import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import { Icon } from "@/app/components/ui/Icon";
import {
  Alert,
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  Field,
  formatCost,
  inputClass,
  PageHeader,
  Spinner,
  StepBody,
  StepHeader,
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
import ModelBrowser from "./ModelBrowser";
import SchemaField from "./SchemaField";

// --------------------------------------------------
// GENERATE PAGE
//
// Guided flow: 1 Project → 2 Model → 3 Inputs. Project
// and model sit in a sticky right panel; inputs, the
// sticky "Run" bar (live cost estimate + Generate) and
// the output in the wide left column. State lives in
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

  // Bring the output into view when a run starts
  const outputRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Create"
        title="Generate"
        description="Create images and video. Every run is costed and charged to a project."
      />

      {/* Project and model on the right, inputs → run →
          output on the left. On narrow screens the right
          column comes first, so the order stays
          project → model → inputs. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ================= RIGHT: PROJECT + MODEL ================= */}
        {/* Sticky on desktop, scrolling on its own if taller
            than the screen, so the choice stays in view while
            filling in inputs */}
        <div className="min-w-0 xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto xl:rounded-xl">
          <Card className="divide-y divide-line">
            {/* STEP 1: PROJECT */}
            <div className="p-5">
              <StepHeader
                step={1}
                title="Project"
                description="Who pays for this run."
                done={Boolean(project)}
              />

              {/* The step title names the control, so the
                field label is for screen readers only */}
              <div className="mt-3 flex items-start gap-3">
                <ProjectAvatar
                  name={project}
                  imageUrl={
                    projectList.find((item) => item.name === project)?.imageUrl
                  }
                  size={40}
                />

                <div className="min-w-0 flex-1">
                  <Field label="Project" hideLabel required hint={projectHint}>
                    {(control) => (
                      <select
                        {...control}
                        value={project}
                        onChange={(event) => setProject(event.target.value)}
                        className={cx(inputClass, !project && "text-fg-subtle")}
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
                    )}
                  </Field>
                </div>
              </div>
            </div>

            {/* STEP 2: MODEL */}
            <div className="p-5">
              <StepHeader
                step={2}
                title="Model"
                description="Approved models have known prices, so spend is tracked exactly."
                done={Boolean(model)}
              />

              {/* Same pattern as Project: icon + native select.
                  Grouped by type, each option shows its price. */}
              <div className="mt-3">
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
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
                      size={18}
                    />
                  </span>

                  <div className="min-w-0 flex-1">
                    <Field
                      label="Model"
                      hideLabel
                      required
                      hint={
                        catalogModel
                          ? `${catalogModel.vendor} · ${catalogModel.summary}`
                          : undefined
                      }
                    >
                      {(control) => (
                        <select
                          {...control}
                          value={model}
                          onChange={(event) => chooseModel(event.target.value)}
                          className={cx(inputClass, !model && "text-fg-subtle")}
                        >
                          <option value="" disabled>
                            Select model
                          </option>

                          {MODEL_KINDS.map((kind) => (
                            <optgroup key={kind} label={KIND_LABELS[kind]}>
                              {MODEL_CATALOG.filter(
                                (item) => item.kind === kind,
                              ).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label} · {item.priceHint}
                                </option>
                              ))}
                            </optgroup>
                          ))}

                          {/* Picked from "Browse all Replicate models" */}
                          {model && !catalogModel && (
                            <optgroup label="Other Replicate model">
                              <option value={model}>{model} · unpriced</option>
                            </optgroup>
                          )}
                        </select>
                      )}
                    </Field>
                  </div>
                </div>

                {/* Selected model from outside the catalog */}
                {model && !catalogModel && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">
                        {model}
                      </p>
                      <p className="mt-0.5 text-xs text-warning">
                        Unpriced model: runs are recorded in Expenses as
                        unpriced ($0).
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => chooseModel("")}
                    >
                      Clear
                    </Button>
                  </div>
                )}

                {/* Any Replicate model: search or browse by category */}
                <ModelBrowser />
              </div>
            </div>
          </Card>
        </div>

        {/* ================= LEFT: INPUTS + RUN + OUTPUT ================= */}
        <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
          {/* STEP 3: INPUTS */}
          <Card className="p-5">
            <StepHeader
              step={3}
              title="Inputs"
              description={
                !model
                  ? "Settings for the model you choose."
                  : catalogModel
                    ? `Settings for ${catalogModel.label}.`
                    : "Settings for the selected model."
              }
            />

            <StepBody>
              {!model ? (
                <EmptyState
                  compact
                  icon="sparkles"
                  title="Choose a model"
                  description="Pick a project and a model, and its settings appear here."
                />
              ) : schemaLoading ? (
                <div
                  className="space-y-3"
                  aria-busy="true"
                  aria-label="Loading model settings"
                >
                  <div className="h-24 animate-pulse rounded-lg bg-raised" />
                  <div className="h-10 w-2/3 animate-pulse rounded-lg bg-raised" />
                  <div className="h-10 w-1/2 animate-pulse rounded-lg bg-raised" />
                </div>
              ) : (
                // Remount per model so uncontrolled text
                // areas reset with the new defaults
                <div key={model} className="space-y-5">
                  {hasPrompt && (
                    <Field
                      label="Prompt"
                      required
                      hint="Describe what you want to create. Be specific about subject, style and lighting."
                    >
                      {(control) => (
                        <StableTextArea
                          {...control}
                          rows={12}
                          value={String(inputs.prompt ?? "")}
                          onChange={(next) => updateInput("prompt", next)}
                          placeholder="A product photo of a ceramic mug on a marble counter, soft morning light…"
                          className={textareaClass}
                        />
                      )}
                    </Field>
                  )}

                  {(hasAspectRatio || hasResolution) && (
                    <div className="grid gap-4 sm:grid-cols-2">
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
                        <Field
                          label="Resolution"
                          hint="Higher resolution costs more."
                        >
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
                    </div>
                  )}

                  {mediaFields.length > 0 && (
                    <div
                      className={cx(
                        "grid gap-5",
                        mediaFields.length > 1 && "sm:grid-cols-2",
                      )}
                    >
                      {mediaFields.map(([key, field]) => (
                        <SchemaField key={key} fieldKey={key} field={field} />
                      ))}
                    </div>
                  )}

                  {mainFields.length > 0 && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      {mainFields.map(([key, field]) => (
                        <div
                          key={key}
                          className={cx(
                            // Long text and toggles span both columns
                            (field.type === "boolean" ||
                              /description|negative/i.test(key)) &&
                              "sm:col-span-2",
                          )}
                        >
                          <SchemaField fieldKey={key} field={field} />
                        </div>
                      ))}
                    </div>
                  )}

                  {advancedFields.length > 0 && (
                    <details className="group rounded-lg border border-line">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-fg-muted hover:text-fg">
                        <span>
                          Advanced settings
                          <span className="ml-1.5 text-fg-subtle">
                            ({advancedFields.length})
                          </span>
                        </span>

                        <Icon
                          name="chevronDown"
                          size={16}
                          className="transition-transform group-open:rotate-180"
                        />
                      </summary>

                      <div className="space-y-5 border-t border-line p-4">
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
            </StepBody>
          </Card>

          {/* RUN: sticks to the bottom of the screen while
              scrolling long inputs, so Generate is always
              in reach */}
          <div className="sticky bottom-4 z-10">
            <Card className="px-4 py-3 shadow-lg">
              {/* One row: cost (and what's missing) on the
                  left, Generate on the right. Project and
                  model are already shown in the side panel. */}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0" aria-live="polite">
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
                    Estimated cost
                  </p>

                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                    {!model ? (
                      <span className="text-sm text-fg-muted">
                        Choose a model to see its price
                      </span>
                    ) : !catalogModel ? (
                      <>
                        <span className="text-lg font-semibold text-warning">
                          Unpriced
                        </span>
                        <span className="text-xs text-fg-subtle">
                          No price on file for this model
                        </span>
                      </>
                    ) : schemaLoading ? (
                      <span className="inline-block h-7 w-24 animate-pulse rounded-md bg-raised" />
                    ) : estimate !== null ? (
                      <>
                        <span className="font-mono text-2xl font-semibold tracking-tight text-fg">
                          ≈ {formatCost(estimate)}
                        </span>
                        <span className="text-xs text-fg-subtle">
                          per run
                          {estimateDetail ? ` · ${estimateDetail}` : ""}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-base font-semibold text-fg">
                          {catalogModel.priceHint}
                        </span>
                        <span className="text-xs text-fg-subtle">
                          depends on the output size
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
                  className="shrink-0 sm:w-48"
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

              {error && (
                <div className="mt-3">
                  <Alert>{error}</Alert>
                </div>
              )}
            </Card>
          </div>

          {/* OUTPUT */}
          <div ref={outputRef} className="scroll-mt-20">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
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

              <div className="p-4" aria-live="polite">
                {isRunning ? (
                  <div className="flex min-h-72 flex-col items-center justify-center rounded-lg bg-sunken text-center">
                    <Spinner className="h-6 w-6 text-accent" />

                    <p className="mt-4 text-sm font-medium text-fg">
                      Generating…
                    </p>

                    <p className="mt-1 max-w-xs text-xs text-fg-subtle">
                      Video can take a few minutes. You can leave this page; the
                      result is saved to History.
                    </p>
                  </div>
                ) : status === "succeeded" && outputUrls.length > 0 ? (
                  <div className="space-y-3">
                    {outputUrls.map((url, index) => {
                      const outputType = getOutputType(url);

                      return (
                        <div
                          key={`${url}-${index}`}
                          className="overflow-hidden rounded-lg border border-line bg-black"
                        >
                          {outputType === "video" ? (
                            <video
                              src={url}
                              className="w-full"
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
                              className="max-h-[560px] w-full object-contain"
                            />
                          )}
                        </div>
                      );
                    })}

                    <div className="flex flex-wrap gap-2">
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
                          Download
                          {outputUrls.length > 1 ? ` ${index + 1}` : ""}
                        </Button>
                      ))}
                    </div>

                    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-sunken p-3.5 text-xs">
                      <div>
                        <dt className="text-fg-subtle">Cost</dt>
                        <dd className="mt-0.5 font-mono font-medium text-fg">
                          {formatCost(result?.costUsd)}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-fg-subtle">Run time</dt>
                        <dd className="mt-0.5 font-medium text-fg">
                          {typeof predictTime === "number"
                            ? `${predictTime.toFixed(1)}s`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : status === "unknown" ? (
                  // Polling gave up; the server still finishes
                  // the run and records it in History
                  <Alert tone="warning">
                    <p className="font-medium">Still waiting on Replicate</p>
                    <p className="mt-0.5 text-xs opacity-90">
                      We stopped checking here, but the run is tracked: its
                      result and cost will appear in History.
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
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

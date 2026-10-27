"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  buildGenerationInputs,
  schemaDefaults,
  type Schema,
} from "@/app/(studio)/replicate/fields";
import { errorMessage, fetchJson } from "@/lib/client/http";
import { uploadInputFile } from "@/lib/client/upload";
import type { ModelKind } from "@/lib/model-catalog";
import type { BrowsableModel } from "@/lib/replicate-models";
import { useStudio } from "./StudioProvider";

// --------------------------------------------------
// GENERATE STATE
//
// Mounted in the studio layout, not the Generate page,
// so a half-filled form and a running generation keep
// going while the user looks at History or Expenses.
// The server also finishes runs on its own (see
// reconcilePending), so closing the tab loses nothing.
//
// One instance per provider (Replicate, Higgsfield), each
// with its own form and run. useGenerate() reads the
// Replicate one, or the one an <ActiveGenerate> picks
// (the Higgsfield page), so the same page and fields
// work for both.
// --------------------------------------------------

export type GenerateProviderId = "replicate" | "higgsfield";

// Where each provider loads a model's settings and
// starts runs; both answer in the same shapes
const ENDPOINTS: Record<GenerateProviderId, { schema: string; generate: string }> = {
  replicate: { schema: "/api/models/schema", generate: "/api/generate" },
  higgsfield: {
    schema: "/api/higgsfield/models/schema",
    generate: "/api/higgsfield/generate",
  },
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 10;
// Same as /api/upload (Replicate's per-file limit)
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type SearchModel = BrowsableModel;

export type Prediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: string | null;
  costUsd?: number | null;
  metrics?: {
    predict_time?: number;
    total_time?: number;
    cost?: number;
  };
};

export type GenerationResult = {
  prediction: Prediction;
  costUsd: number | null;
};

function validCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// The server prices runs from our table; older payload
// shapes are still accepted.
function predictionCost(
  prediction: (Prediction & { cost?: unknown }) | undefined,
  fallback?: unknown
): number | null {
  return (
    validCost(prediction?.costUsd) ??
    validCost(prediction?.cost) ??
    validCost(prediction?.metrics?.cost) ??
    validCost(fallback)
  );
}

export type PendingUpload = {
  // Local object URL; once uploaded it becomes the
  // file's entry in filePreviews, so the preview stays put
  preview: string;
  // 0–100, or null when the upload can't report progress
  progress: number | null;
};

type ChooseModelOptions = {
  // Keeps the id in the search box, so the search
  // doesn't re-run for the previous query
  fromSearch?: boolean;
  // Values to apply over the schema defaults
  presetInputs?: Record<string, unknown>;
};

export type Draft = {
  project: string;
  model: string;
  inputs: Record<string, unknown>;
};

type GenerateContextValue = {
  provider: GenerateProviderId;

  // Project (by name; blank until the user picks one)
  project: string;
  setProject: (name: string) => void;

  // Model
  model: string;
  chooseModel: (id: string, options?: ChooseModelOptions) => void;
  // "Run again" from History: same project, model and
  // settings, ready to tweak and run
  loadDraft: (draft: Draft) => void;
  catalogFilter: ModelKind | "all";
  setCatalogFilter: (filter: ModelKind | "all") => void;
  showOtherModels: boolean;
  toggleOtherModels: () => void;
  search: string;
  setSearch: (query: string) => void;
  searchResults: SearchModel[];
  // The query those results are for: until it matches
  // what's typed, a search is still pending
  searchResultsFor: string;
  searching: boolean;

  // Inputs
  schema: Schema;
  schemaLoading: boolean;
  inputs: Record<string, unknown>;
  updateInput: (key: string, value: unknown) => void;
  // Local previews of uploaded images, by uploaded URL
  filePreviews: Record<string, string>;
  removeImage: (key: string, index: number) => void;
  uploading: Record<string, number>;
  // Files still uploading, shown from a local preview
  pendingUploads: Record<string, PendingUpload[]>;
  // multiple: add to the field's list (default: images
  // do, a video or audio replaces the field's one file)
  uploadFile: (key: string, file: File, multiple?: boolean) => void;

  // Run
  generating: boolean;
  result: GenerationResult | null;
  // When the current run succeeded (ms timestamp), for the
  // loader's landing animation; null otherwise
  finishedAt: number | null;
  error: string;
  setError: (message: string) => void;
  generate: () => void;
};

// The one useGenerate() reads
const GenerateContext = createContext<GenerateContextValue | null>(null);

// Every instance, by provider
const StoreContexts: Record<
  GenerateProviderId,
  React.Context<GenerateContextValue | null>
> = {
  replicate: createContext<GenerateContextValue | null>(null),
  higgsfield: createContext<GenerateContextValue | null>(null),
};

export function GenerateProvider({
  provider = "replicate",
  children,
}: {
  provider?: GenerateProviderId;
  children: React.ReactNode;
}) {
  const endpoints = ENDPOINTS[provider];
  const { projects } = useStudio();

  const [selectedProject, setProject] = useState("");

  // Starts blank so the user must pick a project. Also
  // resets to blank if the chosen project is archived or
  // renamed meanwhile.
  const project = projects.some((item) => item.name === selectedProject)
    ? selectedProject
    : "";

  const [model, setModel] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<ModelKind | "all">(
    "all"
  );
  const [showOtherModels, setShowOtherModels] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchModel[]>([]);
  const [searchResultsFor, setSearchResultsFor] = useState("");
  const [searching, setSearching] = useState(false);

  const [schema, setSchema] = useState<Schema>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>(
    {}
  );
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [pendingUploads, setPendingUploads] = useState<
    Record<string, PendingUpload[]>
  >({});

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Ignore schema responses for a model that is no
  // longer selected (fast clicking between models)
  const latestModelRef = useRef("");
  // Bumped on every model change: uploads that finish
  // afterwards belong to the old form and are dropped
  const formEpochRef = useRef(0);
  // Bumped on every run: an older run's polling stops and
  // can't touch the newer result or error
  const runRef = useRef(0);
  // Latest model search; older responses are ignored
  const searchSeqRef = useRef(0);

  // --------------------------------------------------
  // MODEL SEARCH ("Use another Replicate model")
  // --------------------------------------------------

  useEffect(() => {
    const query = search.trim();

    if (!query || query === model) return;

    // State is only set inside the timer callback
    const timer = setTimeout(async () => {
      const seq = ++searchSeqRef.current;
      const isLatest = () => seq === searchSeqRef.current;

      setSearching(true);
      setError("");

      try {
        const data = await fetchJson<{ models?: SearchModel[] }>(
          `/api/models/search?q=${encodeURIComponent(query)}`
        );

        if (isLatest()) {
          setSearchResults(Array.isArray(data.models) ? data.models : []);
          setSearchResultsFor(query);
        }
      } catch (err) {
        console.error(err);
        if (isLatest()) {
          setSearchResults([]);
          setSearchResultsFor(query);
          setError("Unable to search models.");
        }
      } finally {
        if (isLatest()) setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [search, model]);

  // --------------------------------------------------
  // SELECT MODEL + LOAD ITS SCHEMA
  // --------------------------------------------------

  const clearPreviews = useCallback(() => {
    setFilePreviews((previous) => {
      Object.values(previous).forEach((url) => URL.revokeObjectURL(url));

      return {};
    });
  }, []);

  const chooseModel = useCallback(
    (id: string, options: ChooseModelOptions = {}) => {
      // Clicking the selected model again keeps the form
      if (
        id === latestModelRef.current &&
        !options.presetInputs &&
        !options.fromSearch
      ) {
        return;
      }

      latestModelRef.current = id;
      formEpochRef.current += 1;
      runRef.current += 1;

      setModel(id);
      setUploading({});
      setSearch(options.fromSearch ? id : "");
      setSearchResults([]);
      setResult(null);
      setFinishedAt(null);
      setPendingUploads({});
      setError("");
      clearPreviews();

      if (!id) {
        setSchema({});
        setInputs({});
        setSchemaLoading(false);
        return;
      }

      setSchemaLoading(true);

      fetchJson<{ inputSchema?: Schema }>(
        `${endpoints.schema}?model=${encodeURIComponent(id)}`
      )
        .then((data) => {
          if (latestModelRef.current !== id) return;

          const modelSchema = data.inputSchema ?? {};

          setSchema(modelSchema);
          // Presets only fill fields this model still has
          const preset = Object.fromEntries(
            Object.entries(options.presetInputs ?? {}).filter(
              ([key]) => key in modelSchema
            )
          );

          setInputs({ ...schemaDefaults(id, modelSchema), ...preset });
        })
        .catch((err) => {
          if (latestModelRef.current !== id) return;

          console.error(err);
          setSchema({});
          setInputs({});
          setError("Unable to load model settings.");
        })
        .finally(() => {
          if (latestModelRef.current === id) setSchemaLoading(false);
        });
    },
    [clearPreviews, endpoints]
  );

  const loadDraft = useCallback(
    (draft: Draft) => {
      setProject(draft.project);
      chooseModel(draft.model, { presetInputs: draft.inputs });
    },
    [chooseModel]
  );

  // --------------------------------------------------
  // INPUTS + UPLOADS
  // --------------------------------------------------

  const updateInput = useCallback((key: string, value: unknown) => {
    setInputs((previous) => ({ ...previous, [key]: value }));
  }, []);

  const removeImage = useCallback(
    (key: string, index: number) => {
      const value = inputs[key];
      const images = Array.isArray(value) ? value : value ? [value] : [];

      // Its local preview is freed by the effect below
      setInputs((previous) => ({
        ...previous,
        [key]: images.filter((_, i) => i !== index),
      }));
    },
    [inputs]
  );

  // Free the local copy of files no input points at any
  // more (removed or replaced). Their entries stay until
  // the form resets, but nothing looks them up.
  useEffect(() => {
    const used = new Set(
      Object.values(inputs).flatMap((value) =>
        Array.isArray(value) ? value.map(String) : [String(value)]
      )
    );

    Object.entries(filePreviews).forEach(([url, preview]) => {
      if (!used.has(url)) URL.revokeObjectURL(preview);
    });
  }, [inputs, filePreviews]);

  const uploadFile = useCallback(
    async (key: string, file: File, multiple?: boolean) => {
      const isMedia =
        file.type.startsWith("video/") || file.type.startsWith("audio/");
      const appends = multiple ?? !isMedia;

      if (file.size > MAX_FILE_BYTES) {
        setError("Files must be 100 MB or smaller.");
        return;
      }

      const epoch = formEpochRef.current;
      const sameForm = () => epoch === formEpochRef.current;

      // Per-field upload counter drives the "Uploading…" state
      setUploading((previous) => ({
        ...previous,
        [key]: (previous[key] ?? 0) + 1,
      }));
      setError("");

      // Shown right away from the local file, with progress
      const preview = URL.createObjectURL(file);
      let kept = false;

      const updatePending = (
        change: (list: PendingUpload[]) => PendingUpload[]
      ) => {
        if (!sameForm()) return;

        setPendingUploads((previous) => ({
          ...previous,
          [key]: change(previous[key] ?? []),
        }));
      };

      updatePending((list) => [...list, { preview, progress: null }]);

      try {
        const url = await uploadInputFile(file, (percent) =>
          updatePending((list) =>
            list.map((item) =>
              item.preview === preview ? { ...item, progress: percent } : item
            )
          )
        );

        // The user switched models meanwhile: this file
        // belongs to the old form
        if (!sameForm()) return;

        // The uploaded file keeps the same local preview,
        // so it doesn't reload or flash
        kept = true;
        setFilePreviews((previous) => ({ ...previous, [url]: preview }));

        // One file per field (a video, an audio track)
        if (!appends) {
          updateInput(key, url);
          return;
        }

        // A list (images, or a model's several videos):
        // appended
        setInputs((previous) => {
          const current = previous[key];
          const images = Array.isArray(current)
            ? current
            : current
              ? [current]
              : [];

          return { ...previous, [key]: [...images, url] };
        });
      } catch (err) {
        console.error(err);
        if (sameForm()) {
          setError(errorMessage(err, "Unable to upload the file."));
        }
      } finally {
        if (!kept) URL.revokeObjectURL(preview);
        updatePending((list) => list.filter((item) => item.preview !== preview));

        // A model change already reset the counters
        if (sameForm()) {
          setUploading((previous) => ({
            ...previous,
            [key]: Math.max(0, (previous[key] ?? 1) - 1),
          }));
        }
      }
    },
    [updateInput]
  );

  // --------------------------------------------------
  // POLLING
  // --------------------------------------------------

  const pollPrediction = useCallback((predictionId: string, run: number) => {
    // Stop eventually so a stuck or missing prediction
    // doesn't hit the API every 2s forever.
    const startedAt = Date.now();
    let consecutiveErrors = 0;
    // The output is showing; only the saved copy and the
    // exact cost are still to come
    let shown = false;

    // A newer run (or model change) took over
    const stale = () => run !== runRef.current;

    // Give up, leaving a clear end state instead of a
    // spinner that never stops
    function stopPolling(message: string) {
      // The result is already on screen: just stop
      if (stale() || shown) return;

      setError(message);
      setResult((previous) =>
        previous?.prediction.id === predictionId
          ? {
              ...previous,
              prediction: { ...previous.prediction, status: "unknown" },
            }
          : previous
      );
    }

    function scheduleNext() {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling(
          "Stopped checking: generation took longer than 15 minutes. Check History for the final result."
        );
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    }

    function handlePollError() {
      consecutiveErrors++;

      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        stopPolling(
          "Stopped checking: the prediction status could not be fetched. Check History for the final result."
        );
        return;
      }

      scheduleNext();
    }

    async function poll() {
      if (stale()) return;

      try {
        const data = await fetchJson<{
          prediction?: Prediction;
          costUsd?: number | null;
          // Succeeded; the server is still saving the output
          // and working out the exact cost
          finalizing?: boolean;
        }>(`/api/predictions/${encodeURIComponent(predictionId)}`);

        const prediction = data.prediction;

        if (!prediction) {
          handlePollError();
          return;
        }

        consecutiveErrors = 0;
        const settled = prediction.status === "succeeded" && !data.finalizing;
        // Read now: the updater below runs later
        const alreadyShown = shown;

        setResult((previous) =>
          // Ignore if the user started over meanwhile
          previous?.prediction.id === predictionId
            ? {
                // Once showing, keep the same object: the output
                // mustn't reload while it plays
                prediction: alreadyShown ? previous.prediction : prediction,
                // Settled: the recorded cost, even when unknown
                costUsd: settled
                  ? predictionCost(prediction, data.costUsd)
                  : (predictionCost(prediction, data.costUsd) ?? previous.costUsd),
              }
            : previous
        );

        if (prediction.status === "succeeded" && !shown) {
          shown = true;
          setFinishedAt(Date.now());
        }

        if (
          settled ||
          prediction.status === "failed" ||
          prediction.status === "canceled"
        ) {
          return;
        }

        scheduleNext();
      } catch (err) {
        console.error("Prediction polling error:", err);
        handlePollError();
      }
    }

    setTimeout(poll, 1500);
  }, []);


  // --------------------------------------------------
  // GENERATE
  // --------------------------------------------------

  const generate = useCallback(async () => {
    const run = ++runRef.current;

    setError("");
    setResult(null);

    if (!project) {
      setError("Please select a project.");
      return;
    }

    if (!model) {
      setError("Please select a model.");
      return;
    }

    setGenerating(true);

    try {
      const data = await fetchJson<{
        prediction?: Prediction;
        costUsd?: number | null;
        tracking?: { predictionId?: string };
      }>(endpoints.generate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project,
          model,
          inputs: buildGenerationInputs(inputs),
        }),
      });

      const predictionId =
        data.tracking?.predictionId || data.prediction?.id || "";

      if (!data.prediction || !predictionId) {
        throw new Error("The run didn't start. Please try again.");
      }

      // The user changed model while this was starting
      if (run !== runRef.current) return;

      setResult({
        prediction: { ...data.prediction, id: predictionId },
        costUsd: predictionCost(data.prediction, data.costUsd),
      });

      pollPrediction(predictionId, run);
    } catch (err) {
      console.error(err);
      if (run === runRef.current) {
        setError(errorMessage(err, "Generation failed."));
      }
    } finally {
      setGenerating(false);
    }
  }, [project, model, inputs, pollPrediction, endpoints]);

  const value: GenerateContextValue = {
    provider,
    project,
    setProject,
    model,
    chooseModel,
    loadDraft,
    catalogFilter,
    setCatalogFilter,
    showOtherModels,
    toggleOtherModels: () => setShowOtherModels((open) => !open),
    search,
    setSearch,
    searchResults,
    searchResultsFor,
    searching,
    schema,
    schemaLoading,
    inputs,
    updateInput,
    filePreviews,
    removeImage,
    uploading,
    pendingUploads,
    uploadFile,
    generating,
    result,
    finishedAt,
    error,
    setError,
    generate,
  };

  const Store = StoreContexts[provider];

  return (
    <Store.Provider value={value}>
      {provider === "replicate" ? (
        <GenerateContext.Provider value={value}>
          {children}
        </GenerateContext.Provider>
      ) : (
        children
      )}
    </Store.Provider>
  );
}

export function useGenerate(): GenerateContextValue {
  const value = useContext(GenerateContext);

  if (!value) {
    throw new Error("useGenerate must be used inside <GenerateProvider>");
  }

  return value;
}

// A specific provider's state, e.g. to "Run again" a
// Higgsfield run from History
export function useGenerateStore(provider: GenerateProviderId): GenerateContextValue {
  const value = useContext(StoreContexts[provider]);

  if (!value) {
    throw new Error(`No <GenerateProvider provider="${provider}"> mounted`);
  }

  return value;
}

// Makes useGenerate() inside read this provider's state
export function ActiveGenerate({
  provider,
  children,
}: {
  provider: GenerateProviderId;
  children: React.ReactNode;
}) {
  return (
    <GenerateContext.Provider value={useGenerateStore(provider)}>
      {children}
    </GenerateContext.Provider>
  );
}

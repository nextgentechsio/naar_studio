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
} from "@/app/(studio)/generate/fields";
import { errorMessage, fetchJson } from "@/lib/client/http";
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
// --------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 10;
const MAX_IMAGE_BYTES = 26 * 1024 * 1024;

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
  uploadFile: (key: string, file: File) => void;

  // Run
  generating: boolean;
  result: GenerationResult | null;
  error: string;
  setError: (message: string) => void;
  generate: () => void;
};

const GenerateContext = createContext<GenerateContextValue | null>(null);

export function GenerateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
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
        `/api/models/schema?model=${encodeURIComponent(id)}`
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
    [clearPreviews]
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
      const removed = images[index];

      setInputs((previous) => ({
        ...previous,
        [key]: images.filter((_, i) => i !== index),
      }));

      // Free that image's local preview
      if (typeof removed === "string") {
        setFilePreviews((previous) => {
          if (!previous[removed]) return previous;

          URL.revokeObjectURL(previous[removed]);
          const next = { ...previous };
          delete next[removed];
          return next;
        });
      }
    },
    [inputs]
  );

  const uploadFile = useCallback(
    async (key: string, file: File) => {
      const isMedia =
        file.type.startsWith("video/") || file.type.startsWith("audio/");

      if (!isMedia && file.size > MAX_IMAGE_BYTES) {
        setError("Please use an image smaller than 26 MB.");
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

      try {
        const body = new FormData();
        body.append("file", file, file.name);

        const data = await fetchJson<{ url?: string }>("/api/upload", {
          method: "POST",
          body,
        });

        if (!data.url) {
          throw new Error("Upload did not return a file URL.");
        }

        const url = data.url;

        // The user switched models meanwhile: this file
        // belongs to the old form
        if (!sameForm()) return;

        // VIDEO / AUDIO: single file per field
        if (isMedia) {
          updateInput(key, url);
          return;
        }

        // IMAGE: appended, with a local preview
        setFilePreviews((previous) => ({
          ...previous,
          [url]: URL.createObjectURL(file),
        }));

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

    // A newer run (or model change) took over
    const stale = () => run !== runRef.current;

    // Give up, leaving a clear end state instead of a
    // spinner that never stops
    function stopPolling(message: string) {
      if (stale()) return;

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
        }>(`/api/predictions/${encodeURIComponent(predictionId)}`);

        const prediction = data.prediction;

        if (!prediction) {
          handlePollError();
          return;
        }

        consecutiveErrors = 0;

        setResult((previous) =>
          // Ignore if the user started over meanwhile
          previous?.prediction.id === predictionId
            ? {
                prediction,
                costUsd:
                  predictionCost(prediction, data.costUsd) ??
                  previous.costUsd,
              }
            : previous
        );

        if (
          prediction.status === "succeeded" ||
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
      }>("/api/generate", {
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
        throw new Error("Replicate did not return a prediction.");
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
  }, [project, model, inputs, pollPrediction]);

  const value: GenerateContextValue = {
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
    uploadFile,
    generating,
    result,
    error,
    setError,
    generate,
  };

  return (
    <GenerateContext.Provider value={value}>
      {children}
    </GenerateContext.Provider>
  );
}

export function useGenerate(): GenerateContextValue {
  const value = useContext(GenerateContext);

  if (!value) {
    throw new Error("useGenerate must be used inside <GenerateProvider>");
  }

  return value;
}

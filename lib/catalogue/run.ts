import type { StoredUser } from "@/lib/auth/users";
import { recordGeneration } from "@/lib/generations";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  replicateHeaders,
} from "@/lib/replicate/api";
import { inputSchemaFromModel, missingRequired, shapeInputs } from "@/lib/replicate/inputs";
import { modelPath } from "@/lib/replicate/model";
import type { ImageModelId, Resolution } from "./shared";

// --------------------------------------------------
// CATALOGUE: start one image run
//
// The same steps as POST /api/generate (that route is
// left untouched): Replicate prediction + a normal
// `generations` record, so the run is polled, priced and
// counted in Expenses / History like any other. If the
// record can't be saved the prediction is cancelled, so
// nothing is ever billed untracked.
// --------------------------------------------------

export class RunError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const RECORD_ATTEMPTS = 3;
// Model version + schema, refreshed every 10 minutes
const MODEL_TTL_MS = 10 * 60 * 1000;

type ModelInfo = { version: string; schema: ReturnType<typeof inputSchemaFromModel>; at: number };

const globalForRuns = globalThis as unknown as {
  catalogueModels?: Map<string, ModelInfo>;
};
const models = (globalForRuns.catalogueModels ??= new Map());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function modelInfo(model: string, headers: Record<string, string>): Promise<ModelInfo> {
  const cached = models.get(model);
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached;

  const response = await fetch(replicateApiUrl(`models/${modelPath(model)}`), { headers, cache: "no-store" });
  const data = await readReplicateJson(response);
  if (!response.ok) {
    throw new RunError(502, replicateErrorMessage(data, "Couldn't load the image model"));
  }
  const version = (data.latest_version as { id?: string } | undefined)?.id;
  if (!version) throw new RunError(502, "The image model has no runnable version");

  const info = { version, schema: inputSchemaFromModel(data), at: Date.now() };
  models.set(model, info);
  return info;
}

// The provider inputs for a catalogue shot (3:4 portrait)
export function shotInputs(model: ImageModelId, prompt: string, references: string[], resolution: Resolution) {
  if (model === "openai/gpt-image-2.5-sunburst") {
    return {
      prompt,
      input_images: references,
      aspect_ratio: "3:4",
      quality: resolution === "2K" ? "high" : "medium",
      output_format: "jpeg",
      number_of_images: 1,
      moderation: "low",
    };
  }
  return {
    prompt,
    image_input: references,
    aspect_ratio: "3:4",
    resolution,
    output_format: "jpg",
  };
}

// Starts the run; returns the generation (prediction) id
export async function startImageRun(input: {
  user: StoredUser;
  project: { id: string; name: string };
  model: string;
  inputs: Record<string, unknown>;
}): Promise<string> {
  const headers = replicateHeaders({ "Content-Type": "application/json" });
  if (!headers) {
    console.error("REPLICATE_API_TOKEN is missing");
    throw new RunError(500, "Generation is not configured on the server");
  }

  const info = await modelInfo(input.model, headers);
  const shaped = shapeInputs(input.inputs, info.schema);
  const missing = missingRequired(shaped, info.schema);
  if (missing.length) throw new RunError(422, `Missing required input: ${missing.join(", ")}`);

  const response = await fetch(replicateApiUrl(`models/${modelPath(input.model)}/predictions`), {
    method: "POST",
    headers,
    body: JSON.stringify({ input: shaped }),
  });
  const prediction = await readReplicateJson(response);
  if (!response.ok) {
    throw new RunError(
      response.status >= 500 ? 502 : 422,
      replicateErrorMessage(prediction, "Replicate rejected the request"),
    );
  }

  const id = typeof prediction.id === "string" ? prediction.id : "";
  if (!id) throw new RunError(502, "Replicate did not start the generation");

  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      await recordGeneration({
        predictionId: id,
        user: input.user,
        project: input.project,
        model: input.model,
        version: typeof prediction.version === "string" ? prediction.version : info.version,
        inputs: shaped,
        status: String(prediction.status ?? "starting"),
        createdAt: typeof prediction.created_at === "string" ? prediction.created_at : undefined,
      });
      return id;
    } catch (error) {
      console.error(`Catalogue: record generation failed (attempt ${attempt}):`, id, error);
      if (attempt < RECORD_ATTEMPTS) await sleep(250 * attempt);
    }
  }

  const cancel = await fetch(replicateApiUrl(`predictions/${encodeURIComponent(id)}/cancel`), {
    method: "POST",
    headers,
  }).catch(() => null);
  console.error("UNTRACKED PREDICTION (catalogue), cancel requested:", id, cancel?.status ?? "cancel failed");
  throw new RunError(503, "Couldn't save this run, so it was cancelled. Please try again.");
}

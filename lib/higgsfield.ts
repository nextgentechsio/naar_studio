import { config as configureSdk, higgsfield } from "@higgsfield/client/v2";
import type { Schema, SchemaProperty } from "@/app/(studio)/replicate/fields";
import {
  approxMeteredCostUsd,
  categoryFor,
  fitVideo,
  higgsfieldPriceKind,
  videoLengthProblem,
  meteredCostUsd,
  taskFromSlug,
  videoLimitsFor,
  type HiggsfieldModel,
  type HiggsfieldUsage,
} from "@/lib/higgsfield-models";
import { shapeInputs, type InputSchema } from "@/lib/replicate-inputs";
import { videoInfo } from "@/lib/video-info";

// --------------------------------------------------
// HIGGSFIELD (server side)
//
// Lists the models (with their input schemas) from the
// API, starts runs through the official SDK and checks them
// with the request status endpoint (the SDK only offers
// "start and wait", which a web request can't do).
// Results are reshaped like a Replicate prediction, so
// the rest of the pipeline (saving the output, cost,
// expenses, history) handles both providers the same.
//
// HF_CREDENTIALS ("key-id:key-secret") stays on the
// server; HIGGSFIELD_API_URL points at a stand-in in the
// integration tests.
// --------------------------------------------------

const DEFAULT_API_URL = "https://api.higgsfield.ai";

function apiUrl(): string {
  return (process.env.HIGGSFIELD_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function higgsfieldConfigured(): boolean {
  return /^[^:\s]+:[^:\s]+$/.test(process.env.HF_CREDENTIALS ?? "");
}

let configuredWith: string | null = null;

function ensureSdk() {
  const credentials = process.env.HF_CREDENTIALS ?? "";
  const key = `${credentials}@${apiUrl()}`;

  if (configuredWith === key) return;

  configureSdk({ credentials, baseURL: apiUrl(), maxRetries: 2 });
  configuredWith = key;
}

// A failed call to Higgsfield, with its HTTP status
export class HiggsfieldRequestError extends Error {
  constructor(
    readonly status: number,
    what: string
  ) {
    super(`Higgsfield ${what} failed (${status})`);
  }

  // 401/403: our key is wrong, disabled or revoked
  get keyRejected() {
    return this.status === 401 || this.status === 403;
  }
}

// Same header the SDK sends
function authHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${process.env.HF_CREDENTIALS ?? ""}`,
    Accept: "application/json",
  };
}

type HiggsfieldResponse = {
  status?: string;
  request_id?: string;
  video?: { url?: string } | null;
  images?: { url?: string }[] | null;
  error?: unknown;
};

// --------------------------------------------------
// MODELS
// --------------------------------------------------

type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

type RawModel = {
  slug: string;
  title?: string;
  description?: string;
  operation_type?: string[];
  output_type?: string;
  is_workflow?: boolean;
  input_schema?: JsonSchema | null;
};

// The list changes rarely; one fetch an hour per server
const MODELS_TTL_MS = 60 * 60 * 1000;

const globalForModels = globalThis as unknown as {
  higgsfieldModels?: { at: number; models: Promise<RawModel[]> };
};

async function fetchModels(): Promise<RawModel[]> {
  const response = await fetch(`${apiUrl()}/models?include_schema=true`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    // Read the (small) error body rather than cancel it:
    // awaiting cancel() on Next's server fetch can hang
    // forever, which left the page on "Loading models…"
    await response.text().catch(() => "");
    throw new HiggsfieldRequestError(response.status, "model list");
  }

  const data = (await response.json()) as { items?: RawModel[] };

  return (data.items ?? []).filter(
    (item) => typeof item.slug === "string" && item.slug
  );
}

async function rawModels(): Promise<RawModel[]> {
  const cached = globalForModels.higgsfieldModels;

  if (!cached || Date.now() - cached.at > MODELS_TTL_MS) {
    const models = fetchModels();
    globalForModels.higgsfieldModels = { at: Date.now(), models };
    // A failed fetch isn't kept: the next request retries
    models.catch(() => {
      if (globalForModels.higgsfieldModels?.models === models) {
        globalForModels.higgsfieldModels = undefined;
      }
    });
  }

  return globalForModels.higgsfieldModels!.models;
}

export async function listHiggsfieldModels(): Promise<HiggsfieldModel[]> {
  return (await rawModels()).map((item) => {
    const category = categoryFor(item.operation_type ?? []);

    return {
      id: item.slug,
      title: item.title || item.slug,
      description: item.description ?? "",
      output: item.output_type === "image" ? "image" : "video",
      category,
      task: taskFromSlug(item.slug),
      workflow: Boolean(item.is_workflow),
    };
  });
}

export async function findHiggsfieldModel(slug: string) {
  return (await rawModels()).find((item) => item.slug === slug) ?? null;
}

// "string" from ["string", "null"]
function baseType(field: JsonSchema): string | undefined {
  return Array.isArray(field.type)
    ? field.type.find((type) => type !== "null")
    : field.type;
}

// Nested settings (lists of objects, colour objects) have
// no form control; none is ever required, so they're left
// out and the model uses its defaults
function isFormField(field: JsonSchema): boolean {
  const type = baseType(field);
  if (!type || type === "object") return false;
  if (type === "array") {
    const item = baseType(field.items ?? {});
    return item === "string" || item === "number" || item === "integer";
  }
  return true;
}

function formFields(schema: JsonSchema | null | undefined) {
  return Object.entries(schema?.properties ?? {}).filter(([, field]) =>
    isFormField(field)
  );
}

// The model's settings as the Generate form reads them
// (same shape as a Replicate model's)
export function formSchema(model: RawModel): Schema {
  const schema: Schema = {};

  formFields(model.input_schema).forEach(([key, field], order) => {
    const property: SchemaProperty = {
      type: baseType(field),
      title: field.title,
      description: field.description,
      default: field.default ?? undefined,
      format: field.format ?? field.items?.format,
      minimum: field.minimum,
      maximum: field.maximum,
      // Keep Higgsfield's order
      "x-order": order,
    };

    if (Array.isArray(field.enum)) {
      property.enum = field.enum.filter(
        (value): value is string => typeof value === "string"
      );
    }

    schema[key] = property;
  });

  return schema;
}

// The form's values in the model's types; settings the
// model doesn't have are dropped (Higgsfield refuses them)
export function shapeHiggsfieldInputs(
  model: RawModel,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const fields = formFields(model.input_schema);
  const known = new Set(fields.map(([key]) => key));

  const schema: InputSchema = {
    properties: Object.fromEntries(
      fields.map(([key, field]) => [
        key,
        {
          type: baseType(field),
          format: field.format,
          items: field.items ? { type: baseType(field.items) } : undefined,
        },
      ])
    ),
    required: model.input_schema?.required ?? [],
  };

  const inputs = Object.fromEntries(
    Object.entries(raw).filter(([key]) => known.has(key))
  );

  return shapeInputs(inputs, schema);
}

// --------------------------------------------------
// RUNS
// --------------------------------------------------

// Start a run. Returns its request id; the result comes
// later from checkHiggsfieldRequest. Throws the SDK's
// errors (bad input, not enough credits, …).
export async function startHiggsfield(
  model: string,
  input: Record<string, unknown>
): Promise<{ requestId: string; prediction: Record<string, unknown> }> {
  ensureSdk();

  const response = (await higgsfield.subscribe(model, {
    input,
    withPolling: false,
  })) as HiggsfieldResponse;

  if (!response.request_id) {
    throw new Error("Higgsfield did not return a request id");
  }

  return {
    requestId: response.request_id,
    prediction: toPrediction(response),
  };
}

// Higgsfield's states, in Replicate's words
const STATUS_MAP: Record<string, string> = {
  queued: "starting",
  in_progress: "processing",
  completed: "succeeded",
  failed: "failed",
  nsfw: "failed",
  canceled: "canceled",
  cancelled: "canceled",
};

function toPrediction(response: HiggsfieldResponse): Record<string, unknown> {
  const raw = String(response.status ?? "");
  let status = STATUS_MAP[raw] ?? "processing";

  // A video, or one or more images
  const urls = [
    response.video?.url,
    ...(response.images ?? []).map((image) => image?.url),
  ].filter((url): url is string => typeof url === "string" && url !== "");

  let error =
    typeof response.error === "string" && response.error
      ? response.error
      : null;

  if (raw === "nsfw") {
    error = "Blocked by Higgsfield's content moderation.";
  }

  // "Completed" without a result isn't a success
  if (status === "succeeded" && !urls.length) {
    status = "failed";
    error = error ?? "Higgsfield finished without a result.";
  }

  return {
    id: response.request_id,
    status,
    output: status === "succeeded" ? (urls.length > 1 ? urls : urls[0]) : null,
    error,
    higgsfieldStatus: raw,
  };
}

export async function checkHiggsfieldRequest(
  requestId: string
): Promise<
  | { ok: true; prediction: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  if (!higgsfieldConfigured()) {
    return { ok: false, status: 500, error: "HF_CREDENTIALS is missing" };
  }

  const response = await fetch(
    `${apiUrl()}/requests/${encodeURIComponent(requestId)}/status`,
    { headers: authHeaders(), cache: "no-store" }
  );

  const data = (await response.json().catch(() => null)) as HiggsfieldResponse | null;

  if (!response.ok || !data) {
    return {
      ok: false,
      status: response.status,
      error:
        typeof (data as { detail?: unknown } | null)?.detail === "string"
          ? String((data as { detail: string }).detail)
          : "Failed to fetch the Higgsfield request",
    };
  }

  return { ok: true, prediction: toPrediction({ ...data, request_id: requestId }) };
}

export async function cancelHiggsfieldRequest(requestId: string) {
  return fetch(`${apiUrl()}/requests/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
}

// Where Higgsfield serves results from (CloudFront, with
// several distributions, e.g. d3u0tzju9qaucj, and its
// media hosts), or the stand-in API in tests. The link
// comes from Higgsfield's API, never from the form.
// Results from elsewhere still show, from Higgsfield's
// own link, but aren't saved.
const OUTPUT_DOMAINS = ["higgsfield.ai", "higgs.ai", "cloudfront.net"];

export function isHiggsfieldOutputUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    if (
      OUTPUT_DOMAINS.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      )
    ) {
      return true;
    }
  }

  const base = process.env.HIGGSFIELD_API_URL;
  if (!base) return false;

  try {
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

// --------------------------------------------------
// INPUT FILE UPLOADS
//
// Higgsfield's storage, via a presigned upload link: the
// browser sends the file there directly, and the run
// reads it from Higgsfield's own CDN.
// --------------------------------------------------

export type HiggsfieldUpload = {
  uploadUrl: string;
  // Sent with the upload exactly as given
  uploadHeaders: Record<string, string>;
  publicUrl: string;
};

// A one-hour upload link for one file, or null if
// Higgsfield didn't give a usable one
export async function createHiggsfieldUpload(
  contentType: string
): Promise<HiggsfieldUpload | null> {
  try {
    const response = await fetch(`${apiUrl()}/files/generate-upload-url`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: contentType }),
      cache: "no-store",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as {
      upload_url?: unknown;
      public_url?: unknown;
      upload_headers?: unknown;
    } | null;

    const https = (value: unknown) => {
      try {
        return typeof value === "string" && new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    };
    // Only https links; the stand-in API in tests is http
    const usable = (value: unknown) =>
      https(value) || (typeof value === "string" && Boolean(process.env.HIGGSFIELD_API_URL));

    if (!response.ok || !data || !usable(data.upload_url) || !usable(data.public_url)) {
      console.error("Higgsfield upload link failed:", response.status);
      return null;
    }

    const headers = Object.fromEntries(
      Object.entries(
        data.upload_headers && typeof data.upload_headers === "object" ? data.upload_headers : {}
      ).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );

    return {
      uploadUrl: data.upload_url as string,
      uploadHeaders: { "Content-Type": contentType, ...headers },
      publicUrl: data.public_url as string,
    };
  } catch (error) {
    console.error("Higgsfield upload link failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

// --------------------------------------------------
// PRICES (see lib/higgsfield-models.ts)
// --------------------------------------------------

const QUOTE_TIMEOUT_MS = 15_000;

// Higgsfield's exact price for a run with these inputs,
// for our account (discounts included). Null when it
// only describes a formula (metered models) or can't
// quote these inputs. Free: nothing runs.
export async function quoteHiggsfield(
  model: string,
  input: Record<string, unknown>
): Promise<number | null> {
  try {
    const response = await fetch(`${apiUrl()}/estimate/${model}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as
      | { type?: string; usd?: unknown }
      | null;

    if (!response.ok || data?.type !== "estimate") return null;

    const usd = Number(data.usd);
    return Number.isFinite(usd) && usd >= 0 ? usd : null;
  } catch (error) {
    console.error("Higgsfield quote failed:", model, error instanceof Error ? error.message : error);
    return null;
  }
}

// Input files we may read to measure: our own uploads
// (Vercel Blob) and Higgsfield's outputs. Never an
// arbitrary host from the form.
export function isMeasurableInput(url: URL): boolean {
  return (
    (url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com")) ||
    isHiggsfieldOutputUrl(url)
  );
}

const urls = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && /^https?:\/\//i.test(item)
  );

// What a metered run produced: the output video, and
// each input video's length. Null if any can't be read.
async function measureRun(
  inputs: Record<string, unknown>,
  outputUrl: string
): Promise<HiggsfieldUsage | null> {
  const parse = (url: string) => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  };

  const output = parse(outputUrl);
  const inputVideos = [...urls(inputs.video_url), ...urls(inputs.video_urls)].map(parse);
  if (!output || inputVideos.some((url) => !url)) return null;

  const [video, ...inputInfo] = await Promise.all([
    videoInfo(output, isHiggsfieldOutputUrl),
    ...inputVideos.map((url) => videoInfo(url!, isMeasurableInput)),
  ]);
  if (!video || inputInfo.some((info) => !info)) return null;

  // The requested length is what's billed (the file runs
  // a few frames over); models without one: the file's
  const requested = Number(inputs.duration);

  return {
    width: video.width,
    height: video.height,
    outputSeconds: Number.isFinite(requested) && requested > 0 ? requested : video.seconds,
    inputVideoSeconds: inputInfo.map((info) => info!.seconds),
    imageCount: urls(inputs.image_urls).length,
    resolution: typeof inputs.resolution === "string" ? inputs.resolution : "",
  };
}

// What a succeeded run cost: Higgsfield's quote (taken
// when it started, else now), or the metered formula
// on the measured files. Null when Higgsfield can't say.
export async function higgsfieldRunCostUsd(
  generation: {
    model: string;
    inputs?: Record<string, unknown>;
    quotedCostUsd?: number | null;
  },
  outputUrl: string
): Promise<number | null> {
  const inputs = generation.inputs ?? {};

  switch (higgsfieldPriceKind(generation.model)) {
    case "unreported":
      return null;

    case "quoted":
      return generation.quotedCostUsd ?? quoteHiggsfield(generation.model, inputs);

    case "metered": {
      const usage = await measureRun(inputs, outputUrl);
      if (usage) return meteredCostUsd(generation.model, usage);

      // Shouldn't happen (the output is what we save);
      // the 16:9 figure beats no figure in Expenses
      console.error("Higgsfield run not measurable, recording the 16:9 estimate:", generation.model);
      return approxMeteredCostUsd(generation.model, inputs);
    }
  }
}

// --------------------------------------------------
// INPUT VIDEO CHECK (before a run starts)
//
// Seedance refuses videos outside its pixel range or
// 4–30 s (lib/higgsfield-models.ts). Uploads are resized in the
// browser, but a file picked from the library may be
// too small or large: say so now, not after a failed
// run. Videos that can't be measured are let through.
// --------------------------------------------------

export async function checkInputVideos(
  model: string,
  input: Record<string, unknown>
): Promise<string | null> {
  const limits = videoLimitsFor(model);
  if (!limits) return null;

  const videos = Object.entries(input)
    .filter(([key]) => /video_urls?$/.test(key))
    .flatMap(([, value]) => urls(value));

  for (const url of videos) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (!isMeasurableInput(parsed)) continue;

    const info = await videoInfo(parsed, isMeasurableInput).catch(() => null);
    if (!info?.width || !info.height) continue;

    const length = videoLengthProblem(info.seconds, limits);
    if (length) return length.replace("This video", "A video here");

    const fit = fitVideo(info.width, info.height, limits);
    if (fit.ok) continue;

    return "error" in fit
      ? fit.error
      : `A video here is ${info.width}×${info.height}, which this model doesn't accept (it needs 640×640 to 834×1112 worth of pixels). Generate resizes it to ${fit.resize.width}×${fit.resize.height} automatically in Chrome, Edge or Safari; in other browsers, resize it and upload it again.`;
  }

  return null;
}

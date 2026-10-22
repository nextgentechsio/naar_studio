import { config as configureSdk, higgsfield } from "@higgsfield/client/v2";
import type { Schema, SchemaProperty } from "@/app/(studio)/replicate/fields";
import {
  categoryFor,
  taskFromSlug,
  type HiggsfieldModel,
} from "@/lib/higgsfield-models";
import { shapeInputs, type InputSchema } from "@/lib/replicate-inputs";

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
    await response.body?.cancel();
    throw new Error(`Higgsfield model list failed (${response.status})`);
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

// Where Higgsfield serves results from (its CloudFront
// distribution and media hosts), or the stand-in API in
// tests. Results from elsewhere still show, from
// Higgsfield's own link, but aren't saved.
const OUTPUT_DOMAINS = ["higgsfield.ai", "higgs.ai"];

export function isHiggsfieldOutputUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    if (url.hostname === "d28lhcrx5qdowv.cloudfront.net") return true;
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

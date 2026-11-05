import { randomUUID } from "crypto";
import { after } from "next/server";
import type { StoredUser } from "@/lib/auth/users";
import { recordGeneration } from "@/lib/generations";
import type { Resolution } from "./shared";
import { enqueueJob, pumpQueue } from "./queue";
import { RunError } from "./run";

// --------------------------------------------------
// CATALOGUE: images straight from Google (Nano Banana)
// and OpenAI (GPT Image), as the original catalogue does
// (NANO_BANANA_API_KEY, OPENAI_API_KEY). The request
// shapes follow its AI service (app/providers/*.py).
//
// Each run is a normal `generations` record (provider
// "catalogue"), made on this server through the queue
// (lib/catalogue/queue.ts), like ElevenLabs: finishLocalRun saves the
// image and records the expense, priced from the tokens
// the provider reports (list prices below). So it shows
// in History, Expenses, the Dashboard and its project.
// --------------------------------------------------

export type DirectEngine = "google" | "openai";

// USD per 1M tokens, standard tier (the original
// catalogue's insightsCost.js, checked 23 Oct 2026 on
// ai.google.dev/gemini-api/docs/pricing and
// developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
export const DIRECT_PRICES = {
  google: { input: 1.5, imageOutput: 30, textOutput: 7.5 },
  openai: { textInput: 5, imageInput: 8, imageOutput: 30 },
} as const;

// Used only when a provider reports no usage
const GOOGLE_OUTPUT_TOKENS: Record<Resolution, number> = { "1K": 1120, "2K": 1680 };
const GOOGLE_REF_TOKENS = 1120;
const GOOGLE_TEXT_TOKENS = 900 + 462;
const OPENAI_SIZE: Record<Resolution, string> = { "1K": "1104x1472", "2K": "1536x2048" };
const OPENAI_MEDIUM_TOKENS_1024 = 439;
const OPENAI_REF_TOKENS = 765;

const perMillion = (tokens: number, rate: number) => (tokens * rate) / 1e6;
const round = (usd: number) => Math.round(usd * 1e6) / 1e6;
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

type GoogleUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
};

export function googleCostUsd(usage: GoogleUsage | null | undefined, fallback: { resolution: Resolution; references: number; promptChars: number }) {
  const price = DIRECT_PRICES.google;
  if (!usage || !num(usage.candidatesTokenCount)) {
    return round(
      perMillion(GOOGLE_OUTPUT_TOKENS[fallback.resolution], price.imageOutput) +
        perMillion(GOOGLE_TEXT_TOKENS, price.textOutput) +
        perMillion(fallback.references * GOOGLE_REF_TOKENS + fallback.promptChars / 4, price.input),
    );
  }
  const details = usage.candidatesTokensDetails ?? [];
  const image = details.length
    ? details.filter((item) => item.modality === "IMAGE").reduce((sum, item) => sum + num(item.tokenCount), 0)
    : num(usage.candidatesTokenCount);
  const text = num(usage.candidatesTokenCount) - image + num(usage.thoughtsTokenCount);
  return round(
    perMillion(num(usage.promptTokenCount), price.input) +
      perMillion(image, price.imageOutput) +
      perMillion(text, price.textOutput),
  );
}

type OpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};

export function openaiCostUsd(usage: OpenAIUsage | null | undefined, fallback: { resolution: Resolution; references: number; promptChars: number }) {
  const price = DIRECT_PRICES.openai;
  if (!usage || !num(usage.output_tokens)) {
    const [w, h] = OPENAI_SIZE[fallback.resolution].split("x").map(Number);
    return round(
      perMillion((OPENAI_MEDIUM_TOKENS_1024 * w * h) / (1024 * 1024), price.imageOutput) +
        perMillion(fallback.references * OPENAI_REF_TOKENS, price.imageInput) +
        perMillion(fallback.promptChars / 4, price.textInput),
    );
  }
  const details = usage.input_tokens_details;
  const imageIn = num(details?.image_tokens);
  const textIn = details ? num(details.text_tokens) : num(usage.input_tokens);
  return round(
    perMillion(textIn, price.textInput) + perMillion(imageIn, price.imageInput) + perMillion(num(usage.output_tokens), price.imageOutput),
  );
}

function googleKey() {
  return process.env.NANO_BANANA_API_KEY?.trim() || "";
}
function openaiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}
const googleBase = () => (process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
const openaiBase = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

export function directConfigured(engine: DirectEngine): boolean {
  return Boolean(engine === "google" ? googleKey() : openaiKey());
}

// Timeouts, as the original's AI service: Google 180 s.
// OpenAI is 300 s there; ours must also fit inside one
// 300 s function (lib/catalogue/queue.ts), so 280 s.
export const CALL_TIMEOUT_MS: Record<DirectEngine, number> = { google: 180_000, openai: 280_000 };
const REF_TIMEOUT_MS = 60_000;
// The AI service's limits (app/lib/http.py, schemas.py)
const MAX_REF_BYTES = 50 * 1024 * 1024;
const REF_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PROMPT_CHARS = 32_000;

// A failed call, and whether trying again is safe and
// worthwhile (the original's `retryable`: the provider
// answered 408/429/5xx or never answered; never for a
// blocked image or a bad request)
export class DirectError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function fetchReference(url: string): Promise<{ bytes: Buffer; type: string }> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REF_TIMEOUT_MS) });
  } catch {
    throw new DirectError("Couldn't read a reference image", true);
  }
  if (!response.ok) throw new DirectError(`Couldn't read a reference image (${response.status})`, response.status >= 500);
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!REF_TYPES.includes(type)) throw new DirectError("Reference images must be JPEG, PNG or WebP", false);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REF_BYTES) throw new DirectError("A reference image is over 50 MB", false);
  return { bytes, type };
}

export type DirectRequest = {
  model: string;
  prompt: string;
  references: string[];
  resolution: Resolution;
  // OpenAI only: the original sends high for the Initial
  // Look, else the shot's quality (default medium)
  quality?: "low" | "medium" | "high";
};
type Request = DirectRequest;
export type DirectResult = { bytes: Buffer; contentType: string; costUsd: number; modelVersion?: string | null };
type Result = DirectResult;

// Fetch errors (no answer at all) and timeouts
function unreachable(provider: string, error: unknown): DirectError {
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return new DirectError(timedOut ? `${provider} took too long to answer` : `Couldn't reach ${provider}`, true);
}

function googleFailure(status: number, message: string): DirectError {
  // A key on the free tier gets no Nano Banana image calls
  if (status === 429 && /free.?tier|quota/i.test(message)) {
    return new DirectError(
      /free.?tier/i.test(message)
        ? "Google refused: this API key is on the free tier, which can't make Nano Banana images. Enable billing on its Google project, or pick a Replicate or OpenAI model."
        : "Google's quota for this API key is used up. Try again later, or pick a Replicate or OpenAI model.",
      false,
    );
  }
  return new DirectError(message.split("\n")[0].slice(0, 300) || `Google returned ${status}`, RETRYABLE_STATUS.has(status));
}

// Which Google API makes Nano Banana images. The original's
// legacy engine (whose prompts lib/catalogue/prompt.ts
// ports) uses `interactions`; its RDA engine uses
// `generateContent`. CATALOGUE_GOOGLE_API=generateContent
// switches.
const googleApi = () => (process.env.CATALOGUE_GOOGLE_API === "generateContent" ? "generateContent" : "interactions");

// `interactions` usage (checked against a real response,
// 2026-11-05): total_input_tokens, total_output_tokens with
// output_tokens_by_modality [{modality:"image"|"text",
// tokens}], and total_thought_tokens apart. In the
// generateContent shape for googleCostUsd.
type InteractionUsage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  output_tokens_by_modality?: { modality?: string; tokens?: number }[];
};
export function interactionUsage(usage: InteractionUsage | undefined): GoogleUsage | null {
  if (!usage || typeof usage !== "object" || !num(usage.total_output_tokens)) return null;
  const byModality = usage.output_tokens_by_modality ?? [];
  const image = byModality.filter((item) => item.modality?.toLowerCase() === "image").reduce((sum, item) => sum + num(item.tokens), 0);
  return {
    promptTokenCount: num(usage.total_input_tokens),
    candidatesTokenCount: num(usage.total_output_tokens),
    thoughtsTokenCount: num(usage.total_thought_tokens),
    // The rest of the output is text
    ...(byModality.length
      ? {
          candidatesTokensDetails: [
            { modality: "IMAGE", tokenCount: image },
            { modality: "TEXT", tokenCount: num(usage.total_output_tokens) - image },
          ],
        }
      : {}),
  };
}

// nano_banana.py: POST /v1beta/interactions
async function callGoogleInteractions(request: Request, refs: { bytes: Buffer; type: string }[]): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(`${googleBase()}/v1beta/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": googleKey() },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS.google),
      body: JSON.stringify({
        model: request.model,
        input: [
          ...refs.map((ref) => ({ type: "image", mime_type: ref.type, data: ref.bytes.toString("base64") })),
          { type: "text", text: request.prompt },
        ],
        response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "3:4", image_size: request.resolution },
      }),
    });
  } catch (error) {
    throw unreachable("Google", error);
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    steps?: { content?: { type?: string; data?: string }[] }[];
    usage?: InteractionUsage;
    usageMetadata?: GoogleUsage;
  } | null;
  if (!response.ok) throw googleFailure(response.status, body?.error?.message ?? "");
  if (!body) throw new DirectError("Google returned a response that couldn't be read", false);
  const data = body.steps?.flatMap((step) => step.content ?? []).find((block) => block.type === "image" && block.data)?.data;
  if (!data) throw new DirectError("Google didn't make an image. Try rewording the feedback.", true);
  return {
    bytes: Buffer.from(data, "base64"),
    contentType: "image/jpeg",
    costUsd: googleCostUsd(body.usageMetadata ?? interactionUsage(body.usage), {
      resolution: request.resolution,
      references: refs.length,
      promptChars: request.prompt.length,
    }),
  };
}

// gemini_image.py: generateContent, its safety order and
// response checks
const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
];
const BLOCKED_FINISH = new Set(["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

async function callGoogleGenerateContent(request: Request, refs: { bytes: Buffer; type: string }[]): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(`${googleBase()}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": googleKey() },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS.google),
      body: JSON.stringify({
        generationConfig: { imageConfig: { aspectRatio: "3:4", imageSize: request.resolution } },
        safetySettings: SAFETY_CATEGORIES.map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
        contents: [
          {
            role: "user",
            parts: [
              ...refs.map((ref) => ({ inlineData: { mimeType: ref.type, data: ref.bytes.toString("base64") } })),
              { text: request.prompt },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    throw unreachable("Google", error);
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] };
    }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: GoogleUsage;
    modelVersion?: string;
  } | null;
  if (!response.ok) throw googleFailure(response.status, body?.error?.message ?? "");
  if (!body) throw new DirectError("Google returned a response that couldn't be read", false);

  const candidates = body.candidates ?? [];
  const finish = candidates[0]?.finishReason;
  const blocked = body.promptFeedback?.blockReason || (finish && BLOCKED_FINISH.has(finish) ? finish : null);
  // Checked before the image, as the original does
  if (blocked) throw new DirectError(`Google didn't make an image (${blocked}). Try rewording the feedback.`, false);
  if (!candidates.length) throw new DirectError("Google returned no candidates", true);
  // Skips the model's interim "thought" images
  const image = candidates[0]?.content?.parts?.find((part) => !part.thought && part.inlineData?.data && part.inlineData.mimeType)?.inlineData;
  if (!image?.data) throw new DirectError("Google didn't make an image. Try rewording the feedback.", false);
  return {
    bytes: Buffer.from(image.data, "base64"),
    contentType: image.mimeType || "image/png",
    costUsd: googleCostUsd(body.usageMetadata, { resolution: request.resolution, references: refs.length, promptChars: request.prompt.length }),
    modelVersion: body.modelVersion ?? null,
  };
}

async function callGoogle(request: Request): Promise<Result> {
  const refs = await Promise.all(request.references.map(fetchReference));
  return googleApi() === "generateContent" ? callGoogleGenerateContent(request, refs) : callGoogleInteractions(request, refs);
}

// openai_images.py, as the legacy engine calls it: the
// quality it's given, PNG out (no output_format), no
// moderation; input_fidelity isn't sent for Sunburst
async function callOpenAI(request: Request): Promise<Result> {
  const refs = await Promise.all(request.references.map(fetchReference));
  const headers = { Authorization: `Bearer ${openaiKey()}` };
  const common = { model: request.model, prompt: request.prompt, size: OPENAI_SIZE[request.resolution], quality: request.quality ?? "medium" };
  const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  let response: Response;
  try {
    if (refs.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(common)) form.append(key, value);
      form.append("n", "1");
      const field = refs.length > 1 ? "image[]" : "image";
      refs.forEach((ref, index) =>
        form.append(field, new Blob([new Uint8Array(ref.bytes)], { type: ref.type }), `ref-${index}.${extension[ref.type] ?? "png"}`),
      );
      response = await fetch(`${openaiBase()}/images/edits`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(CALL_TIMEOUT_MS.openai) });
    } else {
      response = await fetch(`${openaiBase()}/images/generations`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...common, n: 1 }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS.openai),
      });
    }
  } catch (error) {
    // A paid call whose outcome is unknown is never re-sent
    const failure = unreachable("OpenAI", error);
    throw new DirectError(failure.message, false);
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    data?: { b64_json?: string }[];
    output_format?: string;
    usage?: OpenAIUsage;
  };
  if (!response.ok) {
    throw new DirectError((body.error?.message ?? "").slice(0, 300) || `OpenAI returned ${response.status}`, RETRYABLE_STATUS.has(response.status));
  }
  const data = body.data?.[0]?.b64_json;
  if (!data) throw new DirectError("OpenAI didn't return an image", false);
  return {
    bytes: Buffer.from(data, "base64"),
    contentType: `image/${body.output_format === "jpeg" || body.output_format === "webp" ? body.output_format : "png"}`,
    costUsd: openaiCostUsd(body.usage, { resolution: request.resolution, references: refs.length, promptChars: request.prompt.length }),
  };
}

// One image, now (the provider call alone, no record)
export function generateDirect(engine: DirectEngine, request: Request): Promise<Result> {
  if (request.prompt.length > MAX_PROMPT_CHARS) {
    return Promise.reject(new DirectError(`The prompt is over ${MAX_PROMPT_CHARS} characters`, false));
  }
  return engine === "google" ? callGoogle(request) : callOpenAI(request);
}

// Records the run and queues the call (lib/catalogue/
// queue.ts); returns the generation id at once
export async function startDirectRun(input: {
  user: StoredUser;
  project: { id: string; name: string };
  productId?: string | null;
  engine: DirectEngine;
  model: string;
  prompt: string;
  references: string[];
  resolution: Resolution;
  quality?: DirectRequest["quality"];
}): Promise<string> {
  if (!directConfigured(input.engine)) {
    throw new RunError(500, `${input.engine === "google" ? "Google (NANO_BANANA_API_KEY)" : "OpenAI (OPENAI_API_KEY)"} isn't configured on the server`);
  }
  if (input.prompt.length > MAX_PROMPT_CHARS) throw new RunError(400, `The prompt is over ${MAX_PROMPT_CHARS} characters`);
  const id = `${input.engine}-${randomUUID()}`;
  await recordGeneration({
    predictionId: id,
    user: input.user,
    project: input.project,
    // One platform for everything Catalogue makes directly
    provider: "catalogue",
    // "-api": never merged with the same model on Replicate
    // in reports grouped by model
    model: `${input.engine}-api/${input.model}`,
    version: input.model,
    inputs: {
      prompt: input.prompt,
      image_input: input.references,
      aspect_ratio: "3:4",
      resolution: input.resolution,
      ...(input.engine === "openai" ? { quality: input.quality ?? "medium" } : {}),
    },
    status: "processing",
  });

  await enqueueJob({
    _id: id,
    productId: input.productId ?? null,
    engine: input.engine,
    request: {
      model: input.model,
      prompt: input.prompt,
      references: input.references,
      resolution: input.resolution,
      ...(input.quality ? { quality: input.quality } : {}),
    },
  });
  after(() => pumpQueue());
  return id;
}

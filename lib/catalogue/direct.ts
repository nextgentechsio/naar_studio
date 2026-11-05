import { randomUUID } from "crypto";
import { after } from "next/server";
import type { StoredUser } from "@/lib/auth/users";
import { finishLocalRun, recordGeneration } from "@/lib/generations";
import type { Resolution } from "./shared";
import { RunError } from "./run";

// --------------------------------------------------
// CATALOGUE: images straight from Google (Nano Banana)
// and OpenAI (GPT Image), as the original catalogue does
// (NANO_BANANA_API_KEY, OPENAI_API_KEY).
//
// Each run is a normal `generations` record (provider
// "google" / "openai"), done on this server after the
// response, like ElevenLabs: finishLocalRun saves the
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

// Provider calls can take a while for 2K images
const CALL_TIMEOUT_MS = 240_000;
const REF_TIMEOUT_MS = 30_000;
const MAX_REF_BYTES = 20 * 1024 * 1024;

async function fetchReference(url: string): Promise<{ bytes: Buffer; type: string }> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REF_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Couldn't read a reference image (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REF_BYTES) throw new Error("A reference image is too large");
  const type = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { bytes, type: type.startsWith("image/") ? type : "image/jpeg" };
}

type Request = { model: string; prompt: string; references: string[]; resolution: Resolution };
type Result = { bytes: Buffer; contentType: string; costUsd: number };

async function callGoogle(request: Request): Promise<Result> {
  const refs = await Promise.all(request.references.map(fetchReference));
  const response = await fetch(`${googleBase()}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": googleKey() },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            ...refs.map((ref) => ({ inlineData: { mimeType: ref.type, data: ref.bytes.toString("base64") } })),
            { text: request.prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: request.resolution } },
      safetySettings: [
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
      ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: GoogleUsage;
  };
  if (!response.ok) {
    const message = body.error?.message ?? "";
    // A key on the free tier gets no Nano Banana image calls
    if (response.status === 429 && /free.?tier|quota/i.test(message)) {
      throw new Error(
        /free.?tier/i.test(message)
          ? "Google refused: this API key is on the free tier, which can't make Nano Banana images. Enable billing on its Google project, or pick a Replicate or OpenAI model."
          : "Google's quota for this API key is used up. Try again later, or pick a Replicate or OpenAI model.",
      );
    }
    throw new Error(message.split("\n")[0].slice(0, 300) || `Google returned ${response.status}`);
  }

  const fallback = { resolution: request.resolution, references: refs.length, promptChars: request.prompt.length };
  const image = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const reason = body.promptFeedback?.blockReason || body.candidates?.[0]?.finishReason || "no image returned";
    throw new Error(`Google didn't make an image (${reason}). Try rewording the feedback.`);
  }
  return {
    bytes: Buffer.from(image.data, "base64"),
    contentType: image.mimeType || "image/png",
    costUsd: googleCostUsd(body.usageMetadata, fallback),
  };
}

async function callOpenAI(request: Request): Promise<Result> {
  const refs = await Promise.all(request.references.map(fetchReference));
  const headers = { Authorization: `Bearer ${openaiKey()}` };
  const common = { model: request.model, prompt: request.prompt, size: OPENAI_SIZE[request.resolution], quality: "medium", output_format: "jpeg", n: "1", moderation: "low" };

  let response: Response;
  if (refs.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(common)) form.append(key, value);
    const field = refs.length > 1 ? "image[]" : "image";
    refs.forEach((ref, index) => form.append(field, new Blob([new Uint8Array(ref.bytes)], { type: ref.type }), `ref-${index}.${ref.type.split("/")[1] ?? "png"}`));
    response = await fetch(`${openaiBase()}/images/edits`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } else {
    response = await fetch(`${openaiBase()}/images/generations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...common, n: 1 }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    data?: { b64_json?: string }[];
    usage?: OpenAIUsage;
  };
  if (!response.ok) throw new Error((body.error?.message ?? "").slice(0, 300) || `OpenAI returned ${response.status}`);
  const data = body.data?.[0]?.b64_json;
  if (!data) throw new Error("OpenAI didn't return an image");
  return {
    bytes: Buffer.from(data, "base64"),
    contentType: "image/jpeg",
    costUsd: openaiCostUsd(body.usage, { resolution: request.resolution, references: refs.length, promptChars: request.prompt.length }),
  };
}

// One image, now (the provider call alone, no record)
export function generateDirect(engine: DirectEngine, request: Request): Promise<Result> {
  return engine === "google" ? callGoogle(request) : callOpenAI(request);
}

// Records the run and does it after the response;
// returns the generation id at once
export async function startDirectRun(input: {
  user: StoredUser;
  project: { id: string; name: string };
  engine: DirectEngine;
  model: string;
  prompt: string;
  references: string[];
  resolution: Resolution;
}): Promise<string> {
  if (!directConfigured(input.engine)) {
    throw new RunError(500, `${input.engine === "google" ? "Google (NANO_BANANA_API_KEY)" : "OpenAI (OPENAI_API_KEY)"} isn't configured on the server`);
  }
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
    },
    status: "processing",
  });

  const request = { model: input.model, prompt: input.prompt, references: input.references, resolution: input.resolution };
  after(async () => {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;
    try {
      const result = await generateDirect(input.engine, request);
      await finishLocalRun(id, { ok: true, ...result, seconds: seconds() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The image model failed";
      console.error(`Catalogue ${input.engine} run failed:`, id, message);
      await finishLocalRun(id, { ok: false, error: message, seconds: seconds() }).catch((finishError) =>
        console.error("Catalogue: couldn't record the failure:", id, finishError),
      );
    }
  });
  return id;
}

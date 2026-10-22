// --------------------------------------------------
// HIGGSFIELD MODELS (shared by server and browser)
//
// The model list comes from Higgsfield's API (see
// lib/higgsfield.ts); this is what both sides need to
// show and price it. No SDK or credentials here: the
// browser imports this.
// --------------------------------------------------

export type HiggsfieldCategory =
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "text-to-image"
  | "image-edit"
  | "other";

// One model as the browser sees it (no input schema)
export type HiggsfieldModel = {
  id: string;
  title: string;
  description: string;
  output: "video" | "image";
  category: HiggsfieldCategory;
  // "Text to video", "Image edit", …
  task: string;
  workflow: boolean;
};

export const CATEGORY_LABELS: Record<HiggsfieldCategory, string> = {
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  "video-to-video": "Video to video",
  "text-to-image": "Text to image",
  "image-edit": "Image editing",
  other: "Other",
};

export const CATEGORY_ORDER: HiggsfieldCategory[] = [
  "text-to-video",
  "image-to-video",
  "video-to-video",
  "text-to-image",
  "image-edit",
  "other",
];

// From Higgsfield's operation types; a model that does
// several is filed under its first
export function categoryFor(operations: string[]): HiggsfieldCategory {
  const first = operations[0] ?? "";

  if (first === "text2video") return "text-to-video";
  if (first === "image2video") return "image-to-video";
  if (first === "video2video") return "video-to-video";
  if (first === "text2image") return "text-to-image";
  if (first === "image_edit") return "image-edit";
  return "other";
}

// "kling-video/v3.0/std/image-to-video" → "Image to video"
export function taskFromSlug(slug: string): string {
  const last = slug.split("/").pop() ?? "";
  if (/^v?\d/.test(last) || !/[a-z]-[a-z]/.test(last)) return "";

  return last.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

// --------------------------------------------------
// PRICES
//
// Higgsfield's API doesn't report prices, so only models
// with a published per-second rate are priced; the rest
// are recorded as unpriced in Expenses. Rates are the
// 16:9 list prices before any discount: estimates. 480p
// is what Higgsfield actually billed ($0.84 for 4s), a
// little over the $0.2056 list price.
// --------------------------------------------------

const PER_SECOND: Record<string, Record<string, number>> = {
  "bytedance/seedance-2.5/text-to-video": {
    "480p": 0.21,
    "720p": 0.4622,
    "1080p": 1.1372,
  },
  "bytedance/seedance-2.5/image-to-video": {
    "480p": 0.21,
    "720p": 0.4622,
    "1080p": 1.1372,
  },
};

export function isPricedHiggsfieldModel(model: string): boolean {
  return model in PER_SECOND;
}

// Cost of a finished run, or null when unknown
export function higgsfieldCostUsd(
  model: string,
  input: Record<string, unknown>
): number | null {
  const rate = PER_SECOND[model]?.[String(input.resolution ?? "720p")];
  const duration = Number(input.duration ?? 5);

  if (!rate || !Number.isFinite(duration) || duration <= 0) return null;

  return Math.round(rate * duration * 10_000) / 10_000;
}

export function higgsfieldPriceHint(model: string): string | null {
  const rates = PER_SECOND[model];
  if (!rates) return null;

  const values = Object.values(rates);
  return `$${Math.min(...values).toFixed(2)}–$${Math.max(...values).toFixed(2)} / sec`;
}

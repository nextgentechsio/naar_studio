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

// What Higgsfield's storage accepts for input files
// (presigned uploads, see lib/higgsfield.ts); other types
// go to Vercel Blob
export const HIGGSFIELD_UPLOAD_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
];

// --------------------------------------------------
// PRICES
//
// Higgsfield's API never says what a finished run cost.
// Three cases:
//
// - "quoted" (most models): Higgsfield's estimate
//   endpoint gives the exact price of a run for our
//   account, discounts included (lib/higgsfield.ts).
// - "metered": billed by what the run produced (the
//   video's size and length, and any input videos), by
//   the formulas below, which Higgsfield publishes. The
//   server measures the files after the run.
// - "unreported": billed by internal AI usage Higgsfield
//   doesn't report; recorded as unpriced.
//
// Metered rates are before any customer discount.
// --------------------------------------------------

export type HiggsfieldPriceKind = "quoted" | "metered" | "unreported";

type Resolution = "480p" | "720p" | "1080p" | "2k" | "4k";

type MeteredPrice = {
  // "tokens": per 1,000 video tokens, where tokens =
  // ceil(width × height × billed seconds × 24 / 1024).
  // "seconds": per billed second.
  unit: "tokens" | "seconds";
  // "any": every resolution the model offers
  rates: Partial<Record<Resolution | "any", number>>;
  // Rate multiplier when input videos are given
  videoInputFactor?: number;
  // Which seconds are billed
  billsOutput: boolean;
  billsInputVideos: boolean;
  // Seconds rounded up to whole ones before billing
  roundUp?: { output?: boolean; input?: boolean };
  // Longest stretch of an input video that's billed
  maxInputSeconds?: number;
  // Per reference image beyond the included ones
  extraImages?: { included: number; each: number };
};

const SEEDANCE_2_5: MeteredPrice = {
  unit: "tokens",
  rates: { "480p": 0.0214, "720p": 0.0214, "1080p": 0.0234 },
  videoInputFactor: 0.6,
  billsOutput: true,
  billsInputVideos: true,
};

const SEEDANCE_2_0: MeteredPrice = {
  unit: "tokens",
  rates: { "480p": 0.014, "720p": 0.014, "1080p": 0.014, "4k": 0.008 },
  videoInputFactor: 0.6,
  billsOutput: true,
  billsInputVideos: true,
};

const WAN_3_0: MeteredPrice = {
  unit: "seconds",
  rates: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  billsOutput: true,
  billsInputVideos: true,
};

const GENJUTSU: MeteredPrice = {
  unit: "seconds",
  rates: { "480p": 0.318, "720p": 0.681, "1080p": 1.632 },
  billsOutput: false,
  billsInputVideos: true,
  roundUp: { input: true },
};

const GENJUTSU_LIGHT: MeteredPrice = {
  unit: "seconds",
  rates: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  billsOutput: true,
  billsInputVideos: true,
  roundUp: { output: true },
  maxInputSeconds: 15,
};

const METERED: Record<string, MeteredPrice> = {
  "bytedance/seedance-2.5/text-to-video": SEEDANCE_2_5,
  "bytedance/seedance-2.5/image-to-video": SEEDANCE_2_5,
  "bytedance/seedance-2.5/reference-to-video": SEEDANCE_2_5,
  "bytedance/seedance-2.5/video-edit": SEEDANCE_2_5,
  "bytedance/seedance-2.5/video-extend": SEEDANCE_2_5,
  "bytedance/seedance-2.0/text-to-video": SEEDANCE_2_0,
  "bytedance/seedance-2.0/image-to-video": SEEDANCE_2_0,
  "bytedance/seedance-2.0/reference-to-video": SEEDANCE_2_0,
  // Only 480p and 720p are published (and offered)
  "higgsfield/cinema-studio/4.0": {
    ...SEEDANCE_2_5,
    rates: { "480p": 0.0214, "720p": 0.0214 },
  },
  "alibaba/wan-3.0/text-to-video": WAN_3_0,
  "alibaba/wan-3.0/image-to-video": WAN_3_0,
  "alibaba/wan-3.0/reference-to-video": WAN_3_0,
  "alibaba/wan-3.0-prime/reference-to-video": {
    ...WAN_3_0,
    rates: { "480p": 0.068, "720p": 0.14, "1080p": 0.28 },
  },
  "higgsfield/genjutsu/motion-transfer/v1.0": GENJUTSU,
  "higgsfield/genjutsu/object-swap/v1.0": GENJUTSU,
  "higgsfield/genjutsu/restyle/v1.0": GENJUTSU,
  "higgsfield/genjutsu-light/motion-transfer/v1.0": GENJUTSU_LIGHT,
  "higgsfield/genjutsu-light/object-swap/v1.0": GENJUTSU_LIGHT,
  "minimax/h3/reference-to-video": {
    unit: "seconds",
    rates: { any: 0.13 },
    billsOutput: true,
    billsInputVideos: false,
    extraImages: { included: 5, each: 0.08 },
  },
};

// Billed by AI token usage, which the API never reports
const UNREPORTED = new Set([
  "higgsfield/ads-studio/v1.0",
  "marketing-studio/image/flare",
  "marketing-studio/image/sunburst",
]);

export function higgsfieldPriceKind(model: string): HiggsfieldPriceKind {
  if (model in METERED) return "metered";
  if (UNREPORTED.has(model)) return "unreported";
  return "quoted";
}

// What a metered run produced, as billed
export type HiggsfieldUsage = {
  // The output video
  width: number;
  height: number;
  outputSeconds: number;
  // Each input video's length
  inputVideoSeconds: number[];
  imageCount: number;
  // The requested resolution ("" when the model has none)
  resolution: string;
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

// "480p" for a 854×480 or 480×854 video
function resolutionOf(usage: Pick<HiggsfieldUsage, "resolution" | "width" | "height">) {
  const named = usage.resolution.toLowerCase();
  if (named) return named;

  const short = Math.min(usage.width, usage.height);
  if (short <= 480) return "480p";
  if (short <= 720) return "720p";
  if (short <= 1080) return "1080p";
  if (short <= 1440) return "2k";
  return "4k";
}

// Cost of a metered run, or null when the model or its
// resolution has no published rate
export function meteredCostUsd(model: string, usage: HiggsfieldUsage): number | null {
  const price = METERED[model];
  if (!price) return null;

  const resolution = resolutionOf(usage) as Resolution;
  let rate = price.rates[resolution] ?? price.rates.any;
  if (rate === undefined) return null;

  if (usage.inputVideoSeconds.length && price.videoInputFactor) {
    rate *= price.videoInputFactor;
  }

  const input = price.billsInputVideos
    ? usage.inputVideoSeconds.reduce((sum, seconds) => {
        const billed = Math.min(seconds, price.maxInputSeconds ?? Infinity);
        return sum + (price.roundUp?.input ? Math.ceil(billed) : billed);
      }, 0)
    : 0;
  const output = price.billsOutput
    ? price.roundUp?.output
      ? Math.ceil(usage.outputSeconds)
      : usage.outputSeconds
    : 0;

  let cost =
    price.unit === "tokens"
      ? (Math.ceil((usage.width * usage.height * (input + output) * 24) / 1024) * rate) / 1000
      : (input + output) * rate;

  if (price.extraImages) {
    cost += Math.max(0, usage.imageCount - price.extraImages.included) * price.extraImages.each;
  }

  return round4(cost);
}

// A 16:9 video at each resolution (what Higgsfield's
// "roughly $x per second" figures assume)
const WIDE: Record<Resolution, [number, number]> = {
  "480p": [854, 480],
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "2k": [2560, 1440],
  "4k": [3840, 2160],
};

const urlCount = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).filter(
    (item) => typeof item === "string" && item.trim()
  ).length;

// Before the run: a metered model's price for a 16:9
// video of the requested length, input videos not
// counted. Null when the length isn't known upfront.
export function approxMeteredCostUsd(
  model: string,
  input: Record<string, unknown>
): number | null {
  if (!(model in METERED)) return null;

  const duration = Number(input.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const resolution = String(input.resolution ?? "").toLowerCase() as Resolution;
  const [width, height] = WIDE[resolution] ?? WIDE["720p"];

  return meteredCostUsd(model, {
    width,
    height,
    outputSeconds: duration,
    inputVideoSeconds: [],
    imageCount: urlCount(input.image_urls),
    resolution,
  });
}

// "$0.21–$1.14 / sec" (16:9), for metered models
export function higgsfieldPriceHint(model: string): string | null {
  const price = METERED[model];
  if (!price) return null;

  const perSecond = Object.entries(price.rates).map(([resolution, rate]) => {
    if (price.unit === "seconds") return rate;
    const [width, height] = WIDE[resolution as Resolution] ?? WIDE["720p"];
    return (width * height * 24 * rate) / 1024 / 1000;
  });

  const low = Math.min(...perSecond);
  const high = Math.max(...perSecond);

  return low === high
    ? `$${low.toFixed(2)} / sec`
    : `$${low.toFixed(2)}–$${high.toFixed(2)} / sec`;
}

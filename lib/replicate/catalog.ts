import { MODEL_IDS } from "@/lib/replicate/cost";

// --------------------------------------------------
// APPROVED MODEL CATALOG
//
// The models the price table in replicate-cost.ts can
// cost. Shown first on the Generate page so spend is
// always tracked; any other Replicate model is still
// reachable via "Browse all models" but is unpriced.
// Keep this in sync with MODEL_IDS.
// --------------------------------------------------

export type ModelKind = "image" | "video" | "upscale";

export type CatalogModel = {
  id: string;
  label: string;
  vendor: string;
  kind: ModelKind;
  summary: string;
  // Short, human price hint from the price table
  priceHint: string;
};

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: MODEL_IDS.NANO_BANANA,
    label: "Nano Banana",
    vendor: "Google",
    kind: "image",
    summary: "Fast image generation and editing",
    priceHint: "$0.039 / image",
  },
  {
    id: MODEL_IDS.NANO_BANANA_2,
    label: "Nano Banana 2",
    vendor: "Google",
    kind: "image",
    summary: "Higher quality, up to 4K",
    priceHint: "$0.045–$0.151 / image",
  },
  {
    id: MODEL_IDS.NANO_BANANA_PRO,
    label: "Nano Banana Pro",
    vendor: "Google",
    kind: "image",
    summary: "Best quality, 2K–4K output",
    priceHint: "$0.15–$0.30 / image",
  },
  {
    id: MODEL_IDS.GPT_IMAGE_25_SUNBURST,
    label: "GPT Image 2.5",
    vendor: "OpenAI",
    kind: "image",
    summary: "Quality tiers from low to max",
    priceHint: "$0.012–$0.50 / image",
  },
  {
    id: MODEL_IDS.KLING_V3_OMNI,
    label: "Kling v3 Omni",
    vendor: "Kuaishou",
    kind: "video",
    summary: "Video with optional audio",
    priceHint: "$0.168–$0.42 / sec",
  },
  {
    id: MODEL_IDS.SEEDANCE_2,
    label: "Seedance 2.0",
    vendor: "ByteDance",
    kind: "video",
    summary: "480p to 4K video",
    priceHint: "$0.08–$1.25 / sec",
  },
  {
    id: MODEL_IDS.SEEDANCE_25,
    label: "Seedance 2.5",
    vendor: "ByteDance",
    kind: "video",
    summary: "480p and 720p video",
    priceHint: "$0.10–$0.97 / sec",
  },
  {
    id: MODEL_IDS.CRYSTAL_UPSCALER,
    label: "Crystal Upscaler",
    vendor: "philz1337x",
    kind: "upscale",
    summary: "Image upscaling, priced by output size",
    priceHint: "$0.05–$3.20 / image",
  },
  {
    id: MODEL_IDS.TOPAZ_IMAGE,
    label: "Topaz Image Upscale",
    vendor: "Topaz Labs",
    kind: "upscale",
    summary: "Image upscaling up to 512 MP",
    priceHint: "$0.05–$0.82 / image",
  },
  {
    id: MODEL_IDS.TOPAZ_VIDEO,
    label: "Topaz Video Upscale",
    vendor: "Topaz Labs",
    kind: "upscale",
    summary: "Video upscaling to 1080p or 4K",
    priceHint: "$0.027–$0.75 / 5 sec",
  },
];

export const KIND_LABELS: Record<ModelKind, string> = {
  image: "Image",
  video: "Video",
  upscale: "Upscale",
};

export function findCatalogModel(
  id: string
): CatalogModel | undefined {
  return MODEL_CATALOG.find((model) => model.id === id);
}

// Friendly name for display ("Nano Banana"); models
// outside the catalog keep their Replicate id
// Higgsfield runs (see lib/higgsfield/client.ts); not in the
// catalog, which lists Replicate models
const OTHER_PROVIDER_LABELS: Record<string, string> = {
  "bytedance/seedance-2.5/text-to-video": "Seedance 2.5 · Higgsfield",
};

export function modelLabel(id: string): string {
  return findCatalogModel(id)?.label ?? OTHER_PROVIDER_LABELS[id] ?? id;
}

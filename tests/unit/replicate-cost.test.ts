import { describe, expect, it } from "vitest";
import { MODEL_IDS, calculateReplicateCost } from "@/lib/replicate/cost";
import { MODEL_CATALOG } from "@/lib/replicate/catalog";

const ok = (input: Record<string, unknown> = {}, extra = {}) => ({
  status: "succeeded",
  input,
  ...extra,
});

const cost = (model: string, input: Record<string, unknown> = {}) =>
  calculateReplicateCost(model, ok(input));

describe("calculateReplicateCost", () => {
  it("prices only succeeded runs", () => {
    for (const status of ["failed", "canceled", "starting", "processing", ""]) {
      expect(
        calculateReplicateCost(MODEL_IDS.NANO_BANANA, { status, input: {} })
      ).toBeNull();
    }
  });

  it("never invents a price for unknown models", () => {
    expect(cost("someone/unknown-model")).toBeNull();
  });

  it("matches model ids case-insensitively", () => {
    expect(cost("Google/Nano-Banana")).toBe(0.039);
  });

  it("uses a provider-supplied cost when present", () => {
    expect(
      calculateReplicateCost(MODEL_IDS.NANO_BANANA, ok({}, { costUsd: 0.5 }))
    ).toBe(0.5);
  });

  // A null/blank cost field means "no cost reported",
  // not "free": Number(null) is 0, which would record $0
  it("ignores null, blank or boolean cost fields", () => {
    for (const value of [null, "", " ", true, false]) {
      expect(
        calculateReplicateCost(
          MODEL_IDS.NANO_BANANA,
          ok({}, { costUsd: value, cost: value, metrics: { cost: value } })
        )
      ).toBe(0.039);
    }
  });

  it("ignores negative or non-finite provider costs", () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        calculateReplicateCost(MODEL_IDS.NANO_BANANA, ok({}, { costUsd: value }))
      ).toBe(0.039);
    }
  });

  it("prices Nano Banana 2 by resolution", () => {
    expect(cost(MODEL_IDS.NANO_BANANA_2, { resolution: "512px" })).toBe(0.045);
    expect(cost(MODEL_IDS.NANO_BANANA_2, { resolution: "1K" })).toBe(0.067);
    expect(cost(MODEL_IDS.NANO_BANANA_2, { resolution: "2K" })).toBe(0.101);
    expect(cost(MODEL_IDS.NANO_BANANA_2, { resolution: "4K" })).toBe(0.151);
    expect(cost(MODEL_IDS.NANO_BANANA_2)).toBe(0.067);
  });

  it("prices Nano Banana Pro by resolution", () => {
    expect(cost(MODEL_IDS.NANO_BANANA_PRO, { resolution: "2K" })).toBe(0.15);
    expect(cost(MODEL_IDS.NANO_BANANA_PRO, { resolution: "4K" })).toBe(0.3);
  });

  it("prices per-second video by duration and never goes negative", () => {
    expect(cost(MODEL_IDS.KLING_V3_OMNI, { duration: 10, mode: "standard" })).toBeCloseTo(1.68);
    expect(cost(MODEL_IDS.KLING_V3_OMNI, { duration: "10", mode: "standard" })).toBeCloseTo(1.68);
    expect(
      cost(MODEL_IDS.KLING_V3_OMNI, { duration: 5, mode: "pro", generate_audio: true })
    ).toBeCloseTo(1.4);
    expect(cost(MODEL_IDS.SEEDANCE_2, { duration: 5, resolution: "1080p" })).toBeCloseTo(2.25);
    expect(
      cost(MODEL_IDS.SEEDANCE_2, { duration: 5, resolution: "480p", reference_video: "https://x" })
    ).toBeCloseTo(0.5);

    for (const duration of [-5, 0]) {
      const value = cost(MODEL_IDS.KLING_V3_OMNI, { duration });
      expect(value === null || value >= 0).toBe(true);
    }
  });

  it("does not price Seedance 2.5 above 720p", () => {
    expect(cost(MODEL_IDS.SEEDANCE_25, { resolution: "1080p" })).toBeNull();
  });

  it("prices upscalers by output megapixels, and only when known", () => {
    expect(cost(MODEL_IDS.CRYSTAL_UPSCALER)).toBeNull();
    expect(cost(MODEL_IDS.CRYSTAL_UPSCALER, { output_width: 2000, output_height: 2000 })).toBe(0.05);
    expect(
      calculateReplicateCost(
        MODEL_IDS.CRYSTAL_UPSCALER,
        ok({}, { logs: "New upscaled resolution: 4000x4000" })
      )
    ).toBe(0.2);
    expect(cost(MODEL_IDS.TOPAZ_IMAGE, { megapixels: 500 })).toBe(0.82);
  });

  it("prices GPT Image by quality", () => {
    expect(cost(MODEL_IDS.GPT_IMAGE_25_SUNBURST, { quality: "low" })).toBe(0.012);
    expect(cost(MODEL_IDS.GPT_IMAGE_25_SUNBURST, { quality: "max" })).toBe(0.5);
    expect(cost(MODEL_IDS.GPT_IMAGE_25_SUNBURST)).toBe(0.25);
  });

  it("returns money rounded to a sane precision", () => {
    // 5 × 0.168 is 0.8400000000000001 in floating point
    expect(cost(MODEL_IDS.KLING_V3_OMNI, { duration: 5, mode: "standard" })).toBe(0.84);
  });
});

describe("model catalog", () => {
  it("only lists models the price table can cost", () => {
    const priced = new Set<string>(Object.values(MODEL_IDS));

    for (const model of MODEL_CATALOG) {
      expect(priced.has(model.id), model.id).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = MODEL_CATALOG.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Topaz video", () => {
  it("is unpriced when the clip length is unknown (no guessing)", () => {
    expect(cost(MODEL_IDS.TOPAZ_VIDEO, { target_resolution: "1080p" })).toBeNull();
  });

  it("scales with the clip length when known", () => {
    expect(
      cost(MODEL_IDS.TOPAZ_VIDEO, { duration: 60, target_resolution: "1080p" })
    ).toBeCloseTo(1.116);
  });
});

// Checked against the live model schemas on Replicate
describe("schema-driven pricing details", () => {
  it("Seedance counts reference_videos (a list) as video input", () => {
    expect(cost(MODEL_IDS.SEEDANCE_2, { duration: 5, reference_videos: ["https://v"] })).toBeCloseTo(1.1);
    expect(cost(MODEL_IDS.SEEDANCE_2, { duration: 5, reference_videos: [] })).toBeCloseTo(0.9);
    expect(cost(MODEL_IDS.SEEDANCE_25, { duration: 5, reference_videos: ["https://v"] })).toBeCloseTo(4.838);
  });

  it("GPT Image bills every image", () => {
    expect(cost(MODEL_IDS.GPT_IMAGE_25_SUNBURST, { quality: "low", number_of_images: 4 })).toBeCloseTo(0.048);
    expect(
      calculateReplicateCost(
        MODEL_IDS.GPT_IMAGE_25_SUNBURST,
        ok({ quality: "high", number_of_images: 4 }, { output: ["a", "b", "c"] })
      )
    ).toBeCloseTo(0.384);
    expect(cost(MODEL_IDS.GPT_IMAGE_25_SUNBURST, { quality: "unknown-tier" })).toBe(0.25);
  });

  it("Kling defaults to the model's own default mode (pro)", () => {
    expect(cost(MODEL_IDS.KLING_V3_OMNI, { duration: 5 })).toBeCloseTo(1.12);
    expect(cost(MODEL_IDS.KLING_V3_OMNI, { duration: 5, mode: "standard" })).toBeCloseTo(0.84);
  });
});

import { describe, expect, it } from "vitest";
import {
  approxMeteredCostUsd,
  higgsfieldPriceHint,
  higgsfieldPriceKind,
  meteredCostUsd,
  type HiggsfieldUsage,
} from "@/lib/higgsfield-models";

const usage = (patch: Partial<HiggsfieldUsage>): HiggsfieldUsage => ({
  width: 1280,
  height: 720,
  outputSeconds: 5,
  inputVideoSeconds: [],
  imageCount: 0,
  resolution: "720p",
  ...patch,
});

describe("Higgsfield metered prices", () => {
  it("matches a real Seedance 2.5 bill ($0.84 for a 530 × 794, 4s, 480p video)", () => {
    expect(
      meteredCostUsd(
        "bytedance/seedance-2.5/image-to-video",
        usage({ width: 530, height: 794, outputSeconds: 4, resolution: "480p" })
      )
    ).toBe(0.8443);
  });

  it("bills input videos, at 0.6× the rate", () => {
    // 1280 × 720 × (3 + 5) × 24 / 1024 = 172,800 tokens
    expect(
      meteredCostUsd("bytedance/seedance-2.5/video-edit", usage({ inputVideoSeconds: [3] }))
    ).toBe(Math.round(172.8 * 0.01284 * 10_000) / 10_000);
    // 1080p rate, no input video
    expect(
      meteredCostUsd(
        "bytedance/seedance-2.5/text-to-video",
        usage({ width: 1920, height: 1080, resolution: "1080p" })
      )
    ).toBe(Math.round(243 * 0.0234 * 10_000) / 10_000);
  });

  it("bills per second where Higgsfield does", () => {
    expect(meteredCostUsd("alibaba/wan-3.0/text-to-video", usage({ resolution: "1080p" }))).toBe(1);
    // Genjutsu: input seconds only, rounded up
    expect(
      meteredCostUsd("higgsfield/genjutsu/restyle/v1.0", usage({ inputVideoSeconds: [4.2] }))
    ).toBe(3.405);
    // Genjutsu Light: output rounded up, input capped at 15s
    expect(
      meteredCostUsd(
        "higgsfield/genjutsu-light/object-swap/v1.0",
        usage({ outputSeconds: 4.2, inputVideoSeconds: [20], resolution: "480p" })
      )
    ).toBe(1);
    // MiniMax H3: extra reference images beyond five
    expect(
      meteredCostUsd("minimax/h3/reference-to-video", usage({ resolution: "2K", imageCount: 7 }))
    ).toBe(0.81);
  });

  it("reads the resolution from the video when the model has none", () => {
    expect(
      meteredCostUsd("alibaba/wan-3.0/text-to-video", usage({ resolution: "", width: 480, height: 854 }))
    ).toBe(0.25);
  });

  it("never invents a rate", () => {
    expect(meteredCostUsd("higgsfield/cinema-studio/4.0", usage({ resolution: "1080p" }))).toBeNull();
    expect(meteredCostUsd("kling-video/v3.0/pro/text-to-video", usage({}))).toBeNull();
  });

  it("estimates a 16:9 video before the run", () => {
    expect(
      approxMeteredCostUsd("bytedance/seedance-2.5/text-to-video", { duration: 4, resolution: "480p" })
    ).toBe(0.8224);
    // No length to go by
    expect(approxMeteredCostUsd("bytedance/seedance-2.5/video-edit", { resolution: "720p" })).toBeNull();
    expect(approxMeteredCostUsd("kling-video/v3.0/pro/text-to-video", { duration: 5 })).toBeNull();
  });

  it("knows how each model is priced", () => {
    expect(higgsfieldPriceKind("bytedance/seedance-2.5/text-to-video")).toBe("metered");
    expect(higgsfieldPriceKind("kling-video/v3.0/pro/text-to-video")).toBe("quoted");
    expect(higgsfieldPriceKind("marketing-studio/image/flare")).toBe("unreported");

    expect(higgsfieldPriceHint("bytedance/seedance-2.5/text-to-video")).toBe("$0.21–$1.14 / sec");
    expect(higgsfieldPriceHint("minimax/h3/reference-to-video")).toBe("$0.13 / sec");
    expect(higgsfieldPriceHint("kling-video/v3.0/pro/text-to-video")).toBeNull();
  });
});

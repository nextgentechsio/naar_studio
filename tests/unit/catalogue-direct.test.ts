import { describe, expect, it } from "vitest";
import { googleCostUsd, openaiCostUsd } from "@/lib/catalogue/direct";

// Catalogue's direct runs are priced from the tokens the
// provider reports (list prices in lib/catalogue/direct.ts)
const fallback = { resolution: "2K" as const, references: 3, promptChars: 4000 };

describe("direct image pricing", () => {
  it("prices Google by input, image output and text/thinking tokens", () => {
    const usage = {
      promptTokenCount: 5000,
      candidatesTokenCount: 1780,
      thoughtsTokenCount: 900,
      candidatesTokensDetails: [
        { modality: "IMAGE", tokenCount: 1680 },
        { modality: "TEXT", tokenCount: 100 },
      ],
    };
    expect(googleCostUsd(usage, fallback)).toBeCloseTo((5000 * 1.5 + 1680 * 30 + 1000 * 7.5) / 1e6, 9);
  });

  it("treats Google output as image tokens when there's no breakdown", () => {
    expect(googleCostUsd({ promptTokenCount: 1000, candidatesTokenCount: 1120 }, fallback)).toBeCloseTo(
      (1000 * 1.5 + 1120 * 30) / 1e6,
      9,
    );
  });

  it("estimates when the provider reports no usage", () => {
    expect(googleCostUsd(null, fallback)).toBeGreaterThan(0.05);
    expect(googleCostUsd(null, fallback)).toBeLessThan(0.1);
    expect(openaiCostUsd(undefined, fallback)).toBeGreaterThan(0.04);
    expect(openaiCostUsd(undefined, fallback)).toBeLessThan(0.1);
  });

  it("prices OpenAI by text input, image input and output tokens", () => {
    const usage = { input_tokens: 3000, input_tokens_details: { text_tokens: 1000, image_tokens: 2000 }, output_tokens: 1317 };
    expect(openaiCostUsd(usage, fallback)).toBeCloseTo((1000 * 5 + 2000 * 8 + 1317 * 30) / 1e6, 9);
  });
});

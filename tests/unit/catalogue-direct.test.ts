import { describe, expect, it, vi } from "vitest";
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

// The provider calls, against a stubbed fetch: request
// shapes and response handling follow the original's AI
// service (app/providers/*.py)
describe("direct provider calls", () => {
  const ref = "https://store.example/ref.png";
  const request = { model: "gemini-nano-banana-2.1", prompt: "a kurta", references: [ref], resolution: "1K" as const };
  const png = Buffer.from("png-bytes");

  async function call(
    engine: "google" | "openai",
    answer: (url: string, init: RequestInit) => Response,
    options: { api?: string; quality?: "high" | "medium" } = {},
  ) {
    const { generateDirect } = await import("@/lib/catalogue/direct");
    const sent: { url: string; init: RequestInit }[] = [];
    process.env.NANO_BANANA_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    if (options.api) process.env.CATALOGUE_GOOGLE_API = options.api;
    else delete process.env.CATALOGUE_GOOGLE_API;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url === ref) return new Response(png, { headers: { "content-type": "image/png" } });
      sent.push({ url, init });
      return answer(url, init);
    });
    try {
      return { result: await generateDirect(engine, { ...request, quality: options.quality }), sent, error: null };
    } catch (error) {
      return { result: null, sent, error: error as Error & { retryable?: boolean } };
    } finally {
      vi.unstubAllGlobals();
    }
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("calls Google interactions by default, as the legacy engine does", async () => {
    const { result, sent } = await call("google", () =>
      json({ steps: [{ content: [{ type: "text", text: "ok" }, { type: "image", data: "aW1n" }] }] }),
    );
    expect(sent[0].url).toMatch(/\/v1beta\/interactions$/);
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.input).toEqual([
      { type: "image", mime_type: "image/png", data: png.toString("base64") },
      { type: "text", text: "a kurta" },
    ]);
    expect(body.response_format).toEqual({ type: "image", mime_type: "image/jpeg", aspect_ratio: "3:4", image_size: "1K" });
    expect(result?.bytes.toString()).toBe("img");
    expect(result?.contentType).toBe("image/jpeg");
  });

  it("generateContent: original settings, skips thought images, refuses blocks", async () => {
    const { result, sent } = await call(
      "google",
      () =>
        json({
          modelVersion: "v1",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  { thought: true, inlineData: { mimeType: "image/png", data: "ZHJhZnQ=" } },
                  { inlineData: { mimeType: "image/png", data: "ZmluYWw=" } },
                ],
              },
            },
          ],
        }),
      { api: "generateContent" },
    );
    const body = JSON.parse(String(sent[0].init.body));
    expect(Object.keys(body)).toEqual(["generationConfig", "safetySettings", "contents"]);
    expect(body.generationConfig).toEqual({ imageConfig: { aspectRatio: "3:4", imageSize: "1K" } });
    expect(body.safetySettings.map((item: { category: string }) => item.category)).toEqual([
      "HARM_CATEGORY_DANGEROUS_CONTENT",
      "HARM_CATEGORY_HARASSMENT",
      "HARM_CATEGORY_HATE_SPEECH",
      "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    ]);
    expect(result?.bytes.toString()).toBe("final");
    expect(result?.modelVersion).toBe("v1");

    // A block fails even with an image, and isn't retried
    const blocked = await call(
      "google",
      () => json({ candidates: [{ finishReason: "SAFETY", content: { parts: [{ inlineData: { mimeType: "image/png", data: "eA==" } }] } }] }),
      { api: "generateContent" },
    );
    expect(blocked.error?.message).toMatch(/SAFETY/);
    expect(blocked.error?.retryable).toBe(false);
    // No candidates: worth one more try
    const empty = await call("google", () => json({ candidates: [] }), { api: "generateContent" });
    expect(empty.error?.retryable).toBe(true);
  });

  it("marks which Google errors are worth retrying", async () => {
    const busy = await call("google", () => json({ error: { message: "high demand" } }, 503));
    expect(busy.error?.retryable).toBe(true);
    const bad = await call("google", () => json({ error: { message: "bad request" } }, 400));
    expect(bad.error?.retryable).toBe(false);
    const free = await call("google", () => json({ error: { message: "limit: 0 on Free Tier" } }, 429));
    expect(free.error?.message).toMatch(/free tier/);
    expect(free.error?.retryable).toBe(false);
  });

  it("OpenAI: the quality it's given, PNG out, no moderation; a lost call isn't retried", async () => {
    const { result, sent } = await call("openai", () => json({ data: [{ b64_json: "aW1n" }] }), { quality: "high" });
    expect(sent[0].url).toMatch(/\/images\/edits$/);
    const form = sent[0].init.body as FormData;
    expect(form.get("quality")).toBe("high");
    expect(form.get("size")).toBe("1104x1472");
    expect(form.has("output_format")).toBe(false);
    expect(form.has("moderation")).toBe(false);
    expect((form.get("image") as File).name).toBe("ref-0.png");
    expect(result?.contentType).toBe("image/png");

    const lost = await call("openai", () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect(lost.error?.retryable).toBe(false);
  });

  it("refuses references that aren't JPEG, PNG or WebP", async () => {
    const { generateDirect } = await import("@/lib/catalogue/direct");
    vi.stubGlobal("fetch", async () => new Response("gif", { headers: { "content-type": "image/gif" } }));
    await expect(generateDirect("google", request)).rejects.toThrow(/JPEG, PNG or WebP/);
    vi.unstubAllGlobals();
  });
});

describe("interactions usage", () => {
  it("prices a real Nano Banana 2.1 response: image tokens at the image rate, the rest as text", async () => {
    const { googleCostUsd, interactionUsage } = await import("@/lib/catalogue/direct");
    // From a real 1K call on 2026-11-05
    const usage = interactionUsage({
      total_input_tokens: 21,
      total_output_tokens: 1395,
      output_tokens_by_modality: [{ modality: "image", tokens: 1120 }],
      total_thought_tokens: 854,
    });
    const cost = googleCostUsd(usage, { resolution: "1K", references: 0, promptChars: 90 });
    expect(cost).toBeCloseTo((21 * 1.5 + 1120 * 30 + (275 + 854) * 7.5) / 1e6, 8);
    expect(cost).toBeCloseTo(0.0421, 4);
  });
});

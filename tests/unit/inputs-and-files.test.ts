import { describe, expect, it } from "vitest";
import {
  buildGenerationInputs,
  orderSchemaFields,
  schemaDefaults,
} from "@/app/(studio)/_generate/fields";
import { formatCost } from "@/app/components/ui/primitives";
import { getOutputType, getOutputUrls } from "@/lib/client/outputs";
import { sniffImageType } from "@/lib/storage/project-images";

describe("buildGenerationInputs (what Replicate receives)", () => {
  it("wraps single image inputs in arrays", () => {
    expect(buildGenerationInputs({ image_input: "u1" })).toEqual({ image_input: ["u1"] });
    expect(buildGenerationInputs({ reference_images: "r" })).toEqual({ reference_images: ["r"] });
  });

  it("turns uploaded lists into one URL for single-file fields", () => {
    expect(buildGenerationInputs({ start_image: ["a", "b"] })).toEqual({ start_image: "a" });
    expect(buildGenerationInputs({ reference_video: ["v"] })).toEqual({ reference_video: "v" });
  });

  it("does not mutate the form state", () => {
    const form = { image_input: "u1", prompt: "p" };
    buildGenerationInputs(form);
    expect(form).toEqual({ image_input: "u1", prompt: "p" });
  });
});

describe("schema helpers", () => {
  it("fills defaults by type", () => {
    expect(
      schemaDefaults("x/y", {
        a: { default: 3 },
        b: { type: "boolean" },
        c: { enum: ["one", "two"] },
        d: { type: "string" },
      })
    ).toEqual({ a: 3, b: false, c: "one", d: "" });
  });

  it("orders fields and hides the dedicated controls", () => {
    const keys = orderSchemaFields({
      prompt: {},
      z: { "x-order": 2 },
      y: { "x-order": 1 },
      aspect_ratio: {},
      disable_safety_filter: {},
    }).map(([key]) => key);

    expect(keys).toEqual(["y", "z"]);
  });
});

describe("sniffImageType (project photos)", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("recognises real image signatures", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("rejects SVG, HTML and truncated files", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats costs", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.039)).toBe("$0.039");
    expect(formatCost(3.285)).toBe("$3.29");
    expect(formatCost(Number.NaN)).toBe("—");
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatCost(0.0004)).toBe("<$0.001");
    expect(formatCost(-0.5)).toBe("-$0.500");
  });

  it("reads output urls and types", () => {
    expect(getOutputUrls("https://a/x.png")).toEqual(["https://a/x.png"]);
    expect(getOutputUrls(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(getOutputUrls({ url: "x" })).toEqual([]);
    expect(getOutputType("https://r.delivery/x/out.MP4?sig=1")).toBe("video");
    expect(getOutputType("/history/abc.webp")).toBe("image");
    expect(getOutputType("https://x/file")).toBe("file");
  });
});

describe("session timer format", async () => {
  const { formatElapsed } = await import("@/app/(studio)/_components/SessionTimer");

  it("shows hh:mm:ss, never negative, with days past 24h", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(-5000)).toBe("00:00:00");
    expect(formatElapsed((1 * 3600 + 24 * 60 + 7) * 1000)).toBe("01:24:07");
    expect(formatElapsed((26 * 3600 + 5) * 1000)).toBe("1d 02:00:05");
  });
});

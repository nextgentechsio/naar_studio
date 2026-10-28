import { describe, expect, it } from "vitest";
import { fieldLabel, type Schema } from "@/app/(studio)/replicate/fields";

// Seedance 2.5 video edit's file inputs, as Higgsfield
// sends them (no titles)
const videoEdit: Schema = {
  prompt: { type: "string" },
  video_url: { type: "string" },
  audio_urls: { type: "array" },
  image_urls: { type: "array" },
  video_urls: { type: "array" },
};

const label = (key: string, schema: Schema, model: string) =>
  fieldLabel(key, schema[key], { schema, model });

describe("file field labels", () => {
  it("names the main video and the references apart", () => {
    const model = "bytedance/seedance-2.5/video-edit";
    expect(label("video_url", videoEdit, model)).toBe("Video to edit");
    expect(label("video_urls", videoEdit, model)).toBe("Reference videos");
    expect(label("image_urls", videoEdit, model)).toBe("Reference images");
    expect(label("audio_urls", videoEdit, model)).toBe("Reference audio");
    expect(label("video_url", videoEdit, "bytedance/seedance-2.5/video-extend")).toBe("Video to extend");
  });

  it("uses Main for other pairs, and keeps Higgsfield's own titles", () => {
    const schema: Schema = {
      image_url: { type: "string" },
      image_urls: { type: "array", title: "Middle frames" },
    };
    expect(label("image_url", schema, "kling-video/v4.0/image-to-video")).toBe("Main image");
    expect(label("image_urls", schema, "kling-video/v4.0/image-to-video")).toBe("Middle frames");
  });

  it("leaves models without a main file as before", () => {
    const schema: Schema = { image_urls: { type: "array" }, video_urls: { type: "array" } };
    expect(label("image_urls", schema, "bytedance/seedance-2.5/reference-to-video")).toBe("Images");
    expect(label("video_urls", schema, "bytedance/seedance-2.5/reference-to-video")).toBe("Videos");
    expect(fieldLabel("image_input", { type: "array" })).toBe("Image input");
  });
});

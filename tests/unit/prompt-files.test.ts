import { describe, expect, it } from "vitest";
import type { Schema } from "@/app/(studio)/_generate/fields";
import { filesPattern, matchFiles, promptFiles } from "@/app/(studio)/_generate/promptFiles";

const tokens = (schema: Schema, inputs: Record<string, unknown>, model = "a/b") =>
  promptFiles(schema, inputs, model).map((file) => file.token);

describe("promptFiles", () => {
  it("numbers a model's images in their order", () => {
    const schema: Schema = { prompt: { type: "string" }, image_input: { type: "array" } };
    expect(tokens(schema, { image_input: ["a", "b", "c"] })).toEqual(["image 1", "image 2", "image 3"]);
  });

  it("numbers each kind on its own", () => {
    const schema: Schema = {
      image_urls: { type: "array" },
      video_urls: { type: "array" },
      audio_urls: { type: "array" },
    };
    expect(tokens(schema, { image_urls: ["a", "b"], video_urls: ["c"], audio_urls: ["d"] })).toEqual([
      "image 1",
      "image 2",
      "video 1",
      "audio 1",
    ]);
  });

  it("names fields when a model has several of one kind", () => {
    const schema: Schema = { image_url: { type: "string" }, end_image_url: { type: "string" } };
    expect(tokens(schema, { image_url: "a", end_image_url: "b" })).toEqual(["image", "end image"]);
  });

  it("calls a main video and its references apart", () => {
    const schema: Schema = { video_url: { type: "string" }, video_urls: { type: "array" } };
    expect(tokens(schema, { video_url: "a", video_urls: ["b", "c"] }, "bytedance/seedance/video-edit")).toEqual([
      "video to edit",
      "video 1",
      "video 2",
    ]);
  });

  it("keeps a model's only image list plain next to a single image", () => {
    const schema: Schema = { image: { type: "string", format: "uri" }, image_input: { type: "array" } };
    expect(tokens(schema, { image: "a", image_input: ["b", "c"] })).toEqual(["image", "image 1", "image 2"]);
  });

  it("names lists apart when a model has two of one kind", () => {
    const schema: Schema = { image_urls: { type: "array" }, style_image_urls: { type: "array" } };
    expect(tokens(schema, { image_urls: ["a"], style_image_urls: ["b"] })).toEqual(["image 1", "style image 1"]);
  });

  it("skips fields with nothing uploaded", () => {
    const schema: Schema = { image_input: { type: "array" }, seed: { type: "integer" } };
    expect(tokens(schema, { image_input: [], seed: 3 })).toEqual([]);
  });
});

describe("matchFiles", () => {
  const files = promptFiles({ image_input: { type: "array" } }, { image_input: ["a", "b"] }, "a/b");

  it("finds by what's typed after /", () => {
    expect(matchFiles(files, "").length).toBe(2);
    expect(matchFiles(files, "im2").map((file) => file.token)).toEqual(["image 2"]);
    expect(matchFiles(files, "2").map((file) => file.token)).toEqual(["image 2"]);
    expect(matchFiles(files, "video")).toEqual([]);
  });
});

describe("filesPattern", () => {
  const files = promptFiles({ image_input: { type: "array" } }, { image_input: ["a", "b"] }, "a/b");

  it("marks whole names only", () => {
    const pattern = filesPattern(files)!;
    const marked = "Put image 1 on image 2, not image 12 or myimage 1"
      .split(pattern)
      .filter((_, index) => index % 2);
    expect(marked).toEqual(["image 1", "image 2"]);
  });

  it("is null with no files", () => {
    expect(filesPattern([])).toBeNull();
  });
});

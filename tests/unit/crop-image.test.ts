import { describe, expect, it } from "vitest";
import { cropArea, parseRatio } from "@/lib/client/crop-image";
import { cropsToAspectRatio, videoCropField } from "@/lib/higgsfield/models";

describe("cropping to an aspect ratio", () => {
  it("reads ratios, and nothing else", () => {
    expect(parseRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseRatio(" 9:16 ")).toBeCloseTo(9 / 16);
    expect(parseRatio("match_input_image")).toBeNull();
    expect(parseRatio("0:1")).toBeNull();
    expect(parseRatio("")).toBeNull();
  });

  it("keeps the middle, as large as fits", () => {
    // Portrait photo to 16:9: full width, middle band
    expect(cropArea(1024, 1536, 16 / 9)).toEqual({ x: 0, y: 480, width: 1024, height: 576 });
    // Wide photo to 9:16: full height, middle column
    expect(cropArea(1920, 1080, 9 / 16)).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    // Square from a wide photo
    expect(cropArea(1600, 900, 1)).toEqual({ x: 350, y: 0, width: 900, height: 900 });
  });

  it("leaves an image that already has the shape", () => {
    expect(cropArea(1920, 1080, 16 / 9)).toBeNull();
    // 1366 × 768 is 16:9 to within rounding
    expect(cropArea(1366, 768, 16 / 9)).toBeNull();
  });

  it("applies to image to video models without an aspect ratio", () => {
    const start = { prompt: {}, image_url: {} };
    expect(cropsToAspectRatio("bytedance/seedance-2.5/image-to-video", { ...start, end_image_url: {} })).toBe(true);
    expect(cropsToAspectRatio("kling-video/v3.0/pro/image-to-video", { ...start, last_image_url: {} })).toBe(true);
    expect(cropsToAspectRatio("wan/v2.6/image-to-video", start)).toBe(true);

    // Has its own aspect_ratio input
    expect(cropsToAspectRatio("some/model/image-to-video", { ...start, aspect_ratio: {} })).toBe(false);
    // Shape follows the video, or the images only guide it
    expect(cropsToAspectRatio("kling-video/v3/motion-control/pro", { ...start, video_url: {} })).toBe(false);
    expect(cropsToAspectRatio("bytedance/seedance-2.5/reference-to-video", { image_urls: {} })).toBe(false);
    // No image to crop
    expect(cropsToAspectRatio("wan/v2.6/text-to-video", { prompt: {} })).toBe(false);
  });

  it("crops the input video of edit and extend models", () => {
    // Seedance: the main video, not the reference videos
    expect(
      videoCropField("bytedance/seedance-2.5/video-edit", { video_url: {}, video_urls: {}, image_urls: {} })
    ).toBe("video_url");
    expect(videoCropField("bytedance/seedance-2.5/video-extend", { video_url: {} })).toBe("video_url");
    // Kling's edits take a list; its first is the main one
    expect(videoCropField("kling-video/o3/video-edit", { video_urls: {}, image_urls: {} })).toBe("video_urls");

    expect(videoCropField("some/video-edit", { video_url: {}, aspect_ratio: {} })).toBeNull();
    expect(videoCropField("kling-video/v3/motion-control/pro", { video_url: {}, image_url: {} })).toBeNull();
    expect(videoCropField("bytedance/seedance-2.5/image-to-video", { image_url: {} })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { fitVideo, videoLengthProblem, videoLimitsFor } from "@/lib/higgsfield/models";

const limits = videoLimitsFor("bytedance/seedance-2.5/video-edit")!;

describe("Seedance input video size", () => {
  it("applies to Seedance and Cinema Studio only", () => {
    expect(videoLimitsFor("bytedance/seedance-2.0/reference-to-video")).toBe(limits);
    expect(videoLimitsFor("higgsfield/cinema-studio/4.0")).toBe(limits);
    expect(videoLimitsFor("kling-video/v4.0/video-edit")).toBeNull();
  });

  it("keeps videos already in range", () => {
    expect(fitVideo(640, 640, limits)).toEqual({ ok: true });
    expect(fitVideo(1280, 720, limits)).toEqual({ ok: true });
    expect(fitVideo(720, 1280, limits)).toEqual({ ok: true });
  });

  it("enlarges a phone clip just under the minimum, keeping its shape", () => {
    const fit = fitVideo(480, 848, limits);
    expect(fit).toEqual({ ok: false, resize: { width: 482, height: 850 } });
    if (!("resize" in fit)) throw new Error("expected a resize");
    const { width, height } = fit.resize;
    expect(width * height).toBeGreaterThanOrEqual(409_600);
    expect(width % 2 + height % 2).toBe(0);
    expect(Math.abs(width / height - 480 / 848)).toBeLessThan(0.005);
  });

  it("shrinks videos over the maximum", () => {
    const fit = fitVideo(1920, 1080, limits);
    if (!("resize" in fit)) throw new Error("expected a resize");
    expect(fit.resize.width * fit.resize.height).toBeLessThanOrEqual(927_408);
    expect(Math.abs(fit.resize.width / fit.resize.height - 16 / 9)).toBeLessThan(0.005);
  });

  it("needs 4 to 30 seconds", () => {
    expect(videoLengthProblem(3.947, limits)).toMatch(/3\.94 seconds long; this model needs 4 to 30/);
    expect(videoLengthProblem(31, limits)).toMatch(/Trim it/);
    expect(videoLengthProblem(3.995, limits)).toBeNull();
    expect(videoLengthProblem(9.13, limits)).toBeNull();
    // Unknown lengths are left to the server
    expect(videoLengthProblem(Number.POSITIVE_INFINITY, limits)).toBeNull();
    expect(videoLengthProblem(Number.NaN, limits)).toBeNull();
  });

  it("refuses shapes it can't fix by resizing", () => {
    expect(fitVideo(3000, 600, limits)).toMatchObject({ ok: false, error: expect.stringMatching(/too narrow or wide/) });
  });
});

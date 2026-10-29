import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  UrlSource,
  VideoSampleSink,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type VideoSample,
} from "mediabunny";
import { Compositor, type RenderItem } from "@/lib/cuts/compositor";
import { layersAt, voicesAt, type VisualLayer } from "@/lib/cuts/frame";
import { projectDuration, withFrameRate, type Project } from "@/lib/cuts/timeline";
import type { PlayerAsset } from "@/lib/cuts/playback";

// --------------------------------------------------
// NAAR CUTS: EXPORT (in the browser)
//
// Every frame is rendered through the same compositor
// as the preview, onto an OffscreenCanvas, with the
// exact source frames decoded by WebCodecs (mediabunny),
// and encoded to MP4. The sound is mixed offline with the
// same volumes, fades and cross-fades as the preview.
// Nothing leaves the browser until the file is done.
// --------------------------------------------------

export type ExportSettings = {
  // Output height; the width follows the project's shape
  height: number;
  fps: number;
  quality: "standard" | "high";
};

export type ExportProgress = { phase: "preparing" | "sound" | "frames" | "finishing"; done: number; total: number };

export const EXPORT_HEIGHTS = [720, 1080, 1440, 2160];

const SAMPLE_RATE = 48000;

export function exportSize(project: Pick<Project, "width" | "height">, height: number) {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even((project.width / project.height) * height), height: even(height) };
}

export async function canExport(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") return false;
  return Boolean(await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: 1280, height: 720 }));
}

// Pulls source frames for one clip, in order
type FrameFeed = { next: () => Promise<VideoSample | null>; last: VideoFrame | null; done: () => Promise<void> };

export async function exportProject(
  source: Project,
  assets: Map<string, PlayerAsset>,
  settings: ExportSettings,
  options: { onProgress?: (progress: ExportProgress) => void; signal?: AbortSignal } = {}
): Promise<Blob> {
  const { onProgress, signal } = options;
  const project = withFrameRate(source, settings.fps);
  const total = projectDuration(project);
  if (total <= 0) throw new Error("The timeline is empty.");

  const { width, height } = exportSize(project, settings.height);
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width, height });
  if (!videoCodec) throw new Error(`This browser can't encode ${width}×${height} video. Try a smaller size, or Chrome.`);

  onProgress?.({ phase: "preparing", done: 0, total });

  // ---------- What every frame shows ----------
  const frames: VisualLayer[][] = [];
  // Per video clip: the file times it's needed at, in order
  const times = new Map<string, number[]>();
  for (let frame = 0; frame < total; frame++) {
    const layers = layersAt(project, frame);
    frames.push(layers);
    for (const layer of layers) {
      if (layer.kind !== "video") continue;
      const list = times.get(layer.clip.id) ?? [];
      list.push(layer.sourceTime);
      times.set(layer.clip.id, list);
    }
  }

  const inputs = new Map<string, Input>();
  const openInput = (assetId: string) => {
    let input = inputs.get(assetId);
    if (!input) {
      input = new Input({ source: new UrlSource(assets.get(assetId)!.url), formats: ALL_FORMATS });
      inputs.set(assetId, input);
    }
    return input;
  };

  const feeds = new Map<string, FrameFeed>();
  const images = new Map<string, ImageBitmap>();

  try {
    for (const [clipId, list] of times) {
      const clip = project.clips.find((item) => item.id === clipId)!;
      if (!clip.assetId || !assets.has(clip.assetId)) continue;
      const track = await openInput(clip.assetId).getPrimaryVideoTrack();
      if (!track) continue;
      const iterator = new VideoSampleSink(track).samplesAtTimestamps(list);
      feeds.set(clipId, {
        last: null,
        next: async () => ((await iterator.next()).value as VideoSample | null | undefined) ?? null,
        done: async () => {
          await iterator.return(undefined);
        },
      });
    }

    for (const clip of project.clips) {
      if (clip.type !== "image" || !clip.assetId || images.has(clip.assetId) || !assets.has(clip.assetId)) continue;
      try {
        const blob = await (await fetch(assets.get(clip.assetId)!.url)).blob();
        images.set(clip.assetId, await createImageBitmap(blob));
      } catch {
        // An image that can't be read is left out, as in the preview
      }
    }

    // ---------- Output ----------
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const canvas = new OffscreenCanvas(width, height);
    const compositor = new Compositor(canvas, width, height, { preserve: true });
    const video = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: settings.quality === "high" ? QUALITY_HIGH : QUALITY_MEDIUM,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(video, { frameRate: settings.fps });

    // ---------- Sound ----------
    onProgress?.({ phase: "sound", done: 0, total });
    const mix = await mixSound(project, assets, total, signal);
    let audioDone: Promise<void> = Promise.resolve();
    let audio: AudioBufferSource | null = null;
    if (mix) {
      const audioCodec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
      if (audioCodec) {
        audio = new AudioBufferSource({ codec: audioCodec, bitrate: settings.quality === "high" ? 256_000 : 160_000 });
        output.addAudioTrack(audio);
      }
    }

    await output.start();
    if (audio && mix) audioDone = audio.add(mix);

    // ---------- Pictures ----------
    try {
      for (let frame = 0; frame < total; frame++) {
        if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

        const items: RenderItem[] = [];

        for (const layer of frames[frame]) {
          if (layer.kind === "video") {
            const feed = feeds.get(layer.clip.id);
            if (!feed) continue;
            const sample = await feed.next();
            if (sample) {
              const next = sample.toVideoFrame();
              sample.close();
              feed.last?.close();
              feed.last = next;
            }
            // Past the file's end: its last frame holds
            const picture = feed.last;
            if (picture) items.push({ layer, source: picture, sourceWidth: picture.displayWidth, sourceHeight: picture.displayHeight });
          } else if (layer.kind === "image") {
            const bitmap = layer.clip.assetId ? images.get(layer.clip.assetId) : undefined;
            if (bitmap) items.push({ layer, source: bitmap, sourceWidth: bitmap.width, sourceHeight: bitmap.height });
          } else {
            items.push({ layer, source: null, sourceWidth: 0, sourceHeight: 0 });
          }
        }

        compositor.render(items, project.background);
        await video.add(frame / settings.fps, 1 / settings.fps);

        // Clips that have finished: let their decoders go
        for (const [clipId, feed] of feeds) {
          const clip = project.clips.find((item) => item.id === clipId)!;
          const lastFrame = clip.start + clip.duration + (clip.transition ? clip.transition.duration : 0) + 2;
          if (frame > lastFrame + project.fps) {
            feed.last?.close();
            await feed.done();
            feeds.delete(clipId);
          }
        }

        if (frame % 5 === 0) onProgress?.({ phase: "frames", done: frame, total });
      }

      onProgress?.({ phase: "finishing", done: total, total });
      await audioDone;
      await output.finalize();
    } catch (error) {
      await output.cancel().catch(() => {});
      throw error;
    } finally {
      compositor.dispose();
    }

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("The export came out empty.");
    return new Blob([buffer], { type: output.format.mimeType });
  } finally {
    for (const feed of feeds.values()) {
      feed.last?.close();
      await feed.done().catch(() => {});
    }
    for (const bitmap of images.values()) bitmap.close();
    for (const input of inputs.values()) input.dispose();
  }
}

// The whole timeline's sound, mixed down to stereo; null
// when nothing is heard
async function mixSound(
  project: Project,
  assets: Map<string, PlayerAsset>,
  total: number,
  signal?: AbortSignal
): Promise<AudioBuffer | null> {
  // Per clip: its first and last heard frames, and its
  // gain on every frame in between
  const spans = new Map<string, { from: number; to: number; gains: number[] }>();
  for (let frame = 0; frame < total; frame++) {
    for (const voice of voicesAt(project, frame)) {
      const span = spans.get(voice.clip.id);
      if (!span) {
        spans.set(voice.clip.id, { from: frame, to: frame, gains: [voice.gain] });
      } else {
        // Frames in between where it was silent count as 0
        while (span.to < frame - 1) {
          span.gains.push(0);
          span.to++;
        }
        span.gains.push(voice.gain);
        span.to = frame;
      }
    }
  }
  if (!spans.size) return null;

  const seconds = total / project.fps;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  let any = false;

  for (const [clipId, span] of spans) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    const clip = project.clips.find((item) => item.id === clipId)!;
    const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
    if (!asset || !clip.assetId) continue;

    if (!decoded.has(clip.assetId)) {
      try {
        const bytes = await (await fetch(asset.url)).arrayBuffer();
        decoded.set(clip.assetId, await context.decodeAudioData(bytes));
      } catch {
        // A video without sound, or sound the browser can't read
        decoded.set(clip.assetId, null);
      }
    }
    const buffer = decoded.get(clip.assetId);
    if (!buffer) continue;

    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = clip.speed;
    const gain = context.createGain();
    node.connect(gain).connect(context.destination);

    const start = span.from / project.fps;
    const offset = Math.max(0, clip.offset + ((span.from - clip.start) / project.fps) * clip.speed);
    if (offset >= buffer.duration) continue;
    const length = ((span.to - span.from + 1) / project.fps) * clip.speed;

    gain.gain.setValueAtTime(span.gains[0], start);
    span.gains.forEach((value, index) => gain.gain.linearRampToValueAtTime(value, (span.from + index + 1) / project.fps));
    node.start(start, offset, length);
    any = true;
  }

  return any ? context.startRendering() : null;
}

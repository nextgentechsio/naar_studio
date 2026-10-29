import type { CutAsset } from "@/lib/cuts/types";
import { CUT_PEAKS_MAX } from "@/lib/cuts/types";

// --------------------------------------------------
// NAAR CUTS: MEASURING FILES (browser)
//
// Once per file, after it's added: its length and size,
// and for sound a waveform (peak levels), saved with the
// file so it's never measured again. Thumbnails for the
// timeline's filmstrips are made on demand and kept for
// the session.
// --------------------------------------------------

export type Measured = { durationMs?: number; width?: number; height?: number; peaks?: number[] };

// Waveform resolution: peaks per second of sound
const PEAKS_PER_SECOND = 40;
// Bigger files skip the waveform (decoding is heavy)
const PEAKS_MAX_BYTES = 150 * 1024 * 1024;

function metadata(url: string, kind: "video" | "audio"): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    element.crossOrigin = "anonymous";
    element.preload = "metadata";
    element.muted = true;
    const done = (value: { duration: number; width: number; height: number } | null) => {
      element.removeAttribute("src");
      element.load();
      resolve(value);
    };
    element.onloadedmetadata = () => {
      const video = element as HTMLVideoElement;
      done({
        duration: Number.isFinite(element.duration) ? element.duration : 0,
        width: video.videoWidth ?? 0,
        height: video.videoHeight ?? 0,
      });
    };
    element.onerror = () => done(null);
    element.src = url;
  });
}

// The loudest moment in each slice, 0–255
export function peaksOf(buffer: { numberOfChannels: number; length: number; sampleRate: number; getChannelData(index: number): Float32Array }): number[] {
  const seconds = buffer.length / buffer.sampleRate;
  const count = Math.max(1, Math.min(CUT_PEAKS_MAX, Math.round(seconds * PEAKS_PER_SECOND)));
  const size = Math.max(1, Math.floor(buffer.length / count));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const peaks: number[] = [];

  for (let slice = 0; slice < count; slice++) {
    let peak = 0;
    const from = slice * size;
    const to = Math.min(buffer.length, from + size);
    for (const data of channels) {
      // Every 4th sample is plenty for a picture
      for (let index = from; index < to; index += 4) peak = Math.max(peak, Math.abs(data[index]));
    }
    peaks.push(Math.min(255, Math.round(peak * 255)));
  }

  return peaks;
}

async function waveform(url: string): Promise<number[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(bytes);
    return peaksOf(buffer);
  } catch {
    // No sound track, or a format the browser can't read
    return null;
  }
}

export async function measureAsset(asset: CutAsset): Promise<Measured> {
  if (asset.kind === "image") {
    try {
      const bitmap = await createImageBitmap(await (await fetch(asset.url)).blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return {};
    }
  }

  const kind = asset.kind === "audio" ? "audio" : "video";
  const [info, peaks] = await Promise.all([
    asset.durationMs ? Promise.resolve(null) : metadata(asset.url, kind),
    asset.peaks || asset.size > PEAKS_MAX_BYTES ? Promise.resolve(null) : waveform(asset.url),
  ]);

  const measured: Measured = {};
  if (info?.duration) measured.durationMs = Math.round(info.duration * 1000);
  if (info?.width) measured.width = info.width;
  if (info?.height) measured.height = info.height;
  if (peaks?.length) measured.peaks = peaks;
  return measured;
}

// ---------- Filmstrip thumbnails ----------

const THUMB_HEIGHT = 72;

type Strip = { video: HTMLVideoElement; queue: { time: number; resolve: (url: string | null) => void }[]; busy: boolean };

const strips = new Map<string, Strip>();
const thumbs = new Map<string, Promise<string | null>>();

// A small picture of `url` at `seconds` (rounded to
// `step`), as an object URL; cached for the session
export function thumbnail(url: string, seconds: number, step = 1): Promise<string | null> {
  const time = Math.max(0, Math.round(seconds / step) * step);
  const key = `${url}@${time}`;
  const cached = thumbs.get(key);
  if (cached) return cached;

  const promise = new Promise<string | null>((resolve) => {
    let strip = strips.get(url);
    if (!strip) {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      strip = { video, queue: [], busy: false };
      strips.set(url, strip);
    }
    strip.queue.push({ time, resolve });
    void runStrip(strip);
  });

  thumbs.set(key, promise);
  return promise;
}

async function runStrip(strip: Strip) {
  if (strip.busy) return;
  strip.busy = true;

  while (strip.queue.length) {
    const job = strip.queue.shift()!;
    job.resolve(await grab(strip.video, job.time));
  }
  strip.busy = false;
}

function grab(video: HTMLVideoElement, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    const capture = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", capture);
      try {
        const width = Math.max(1, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * THUMB_HEIGHT));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = THUMB_HEIGHT;
        canvas.getContext("2d")!.drawImage(video, 0, 0, width, THUMB_HEIGHT);
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/jpeg", 0.7);
      } catch {
        resolve(null);
      }
    };
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", capture);
      resolve(null);
    }, 8000);

    const seek = () => {
      const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : time;
      video.addEventListener("seeked", capture);
      video.currentTime = Math.min(time, end);
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  });
}

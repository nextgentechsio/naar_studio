import { Compositor, type RenderItem } from "@/lib/cuts/compositor";
import { layersAt, voicesAt } from "@/lib/cuts/frame";
import { clipEnd, projectDuration, sourceTime, type Clip, type Project } from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: PREVIEW PLAYBACK
//
// One media element per clip in view (a <video> for video
// clips, <audio> for sound), all kept in step with one
// playhead clock, so picture and sound stay together.
// Sound goes through Web Audio: each clip's
// gain (volume, fades, keyframes, mute/solo) is set every
// frame from the same mix the export uses. Clips about to
// start are loaded and parked at their first frame
// ahead of time, so cuts don't stall.
// --------------------------------------------------

export type PlayerAsset = { url: string; kind: "video" | "image" | "audio" | "export" };

type Media = {
  element: HTMLVideoElement | HTMLAudioElement;
  url: string;
  gain: GainNode | null;
  // Last frame it was needed (to let go of old ones)
  usedAt: number;
};

// Seconds of drift tolerated while playing before a seek
const DRIFT_SECONDS = 0.15;
// Load clips starting this soon
const PRELOAD_SECONDS = 2.5;
// Let go of elements unused for this long (ms)
const RELEASE_MS = 8000;

export class Player {
  private compositor: Compositor;
  private project: Project;
  private assets: Map<string, PlayerAsset> = new Map();
  private media = new Map<string, Media>();
  private images = new Map<string, ImageBitmap | "loading" | "failed">();
  private parking: HTMLDivElement;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;

  private playing = false;
  private rate = 1;
  // Where playback started, on the timeline and the clock
  private startFrame = 0;
  private startClock = 0;
  private frameValue = 0;
  private raf = 0;
  private renderQueued = false;

  onFrame: (frame: number) => void = () => {};
  onPlayingChange: (playing: boolean) => void = () => {};

  constructor(canvas: HTMLCanvasElement, project: Project) {
    this.project = project;
    this.compositor = new Compositor(canvas, project.width, project.height);

    // Media elements decode most reliably when they're in
    // the document; parked out of sight
    this.parking = document.createElement("div");
    this.parking.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(this.parking);
  }

  get frame() {
    return this.frameValue;
  }

  get isPlaying() {
    return this.playing;
  }

  setProject(project: Project) {
    const resized = project.width !== this.project.width || project.height !== this.project.height;
    this.project = project;
    if (resized) {
      const canvas = this.compositor.canvas as HTMLCanvasElement;
      this.compositor.dispose();
      this.compositor = new Compositor(canvas, project.width, project.height);
    }
    if (!this.playing) this.requestRender();
  }

  setAssets(assets: Map<string, PlayerAsset>) {
    this.assets = assets;
    if (!this.playing) this.requestRender();
  }

  // ---------- Audio ----------

  private ensureAudio() {
    if (this.context) return this.context;

    const context = new AudioContext({ latencyHint: "interactive" });
    const master = context.createGain();
    const splitter = context.createChannelSplitter(2);
    const left = context.createAnalyser();
    const right = context.createAnalyser();
    left.fftSize = right.fftSize = 512;

    master.connect(context.destination);
    master.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);

    this.context = context;
    this.master = master;
    this.analysers = [left, right];

    // Elements made before sound was allowed
    for (const media of this.media.values()) this.connect(media);
    return context;
  }

  private connect(media: Media) {
    if (!this.context || !this.master || media.gain) return;
    try {
      const source = this.context.createMediaElementSource(media.element);
      media.gain = this.context.createGain();
      media.gain.gain.value = 0;
      source.connect(media.gain).connect(this.master);
      media.element.muted = false;
    } catch {
      // Already routed, or not allowed: stays silent
    }
  }

  // Peak levels 0–1, left and right
  levels(): [number, number] {
    if (!this.analysers || !this.playing) return [0, 0];
    return this.analysers.map((analyser) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value));
      return Math.min(1, peak);
    }) as [number, number];
  }

  // ---------- Media ----------

  private mediaFor(clip: Clip): Media | null {
    const asset = clip.assetId ? this.assets.get(clip.assetId) : null;
    if (!asset || (clip.type !== "video" && clip.type !== "audio")) return null;

    let media = this.media.get(clip.id);
    if (media && media.url !== asset.url) {
      this.release(clip.id);
      media = undefined;
    }

    if (!media) {
      const element = document.createElement(clip.type === "video" ? "video" : "audio");
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      element.muted = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.src = asset.url;
      element.addEventListener("seeked", () => this.requestRender());
      element.addEventListener("loadeddata", () => this.requestRender());
      this.parking.appendChild(element);
      media = { element, url: asset.url, gain: null, usedAt: performance.now() };
      this.media.set(clip.id, media);
      this.connect(media);
    }

    media.usedAt = performance.now();
    return media;
  }

  private release(clipId: string) {
    const media = this.media.get(clipId);
    if (!media) return;
    media.element.pause();
    media.gain?.disconnect();
    media.element.removeAttribute("src");
    media.element.load();
    media.element.remove();
    this.media.delete(clipId);
  }

  private imageFor(assetId: string | null): ImageBitmap | null {
    if (!assetId) return null;
    const cached = this.images.get(assetId);
    if (cached instanceof ImageBitmap) return cached;
    if (cached) return null;

    const asset = this.assets.get(assetId);
    if (!asset) return null;
    this.images.set(assetId, "loading");
    fetch(asset.url)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        this.images.set(assetId, bitmap);
        this.requestRender();
      })
      .catch(() => this.images.set(assetId, "failed"));
    return null;
  }

  // Every element where it should be for `frame`
  private sync(frame: number) {
    const { project } = this;
    const fps = project.fps;
    const layers = layersAt(project, frame);
    const voices = voicesAt(project, frame);
    const gains = new Map(voices.map((voice) => [voice.clip.id, voice.gain]));
    const needed = new Map<string, number>();

    for (const layer of layers) if (layer.kind === "video") needed.set(layer.clip.id, layer.sourceTime);
    for (const voice of voices) needed.set(voice.clip.id, voice.sourceTime);

    for (const [clipId, target] of needed) {
      const clip = project.clips.find((item) => item.id === clipId)!;
      const media = this.mediaFor(clip);
      if (!media) continue;
      const { element } = media;

      if (this.playing && this.rate > 0) {
        element.playbackRate = Math.min(16, Math.max(0.0625, clip.speed * this.rate));
        if (element.paused) {
          element.currentTime = target;
          void element.play().catch(() => {});
        } else if (Math.abs(element.currentTime - target) > DRIFT_SECONDS * Math.max(1, this.rate)) {
          element.currentTime = target;
        }
      } else {
        if (!element.paused) element.pause();
        if (Math.abs(element.currentTime - target) > 0.5 / fps) element.currentTime = target;
      }

      if (media.gain && this.context) {
        const gain = this.playing ? (gains.get(clipId) ?? 0) : 0;
        media.gain.gain.setTargetAtTime(gain, this.context.currentTime, 0.015);
      }
    }

    // Park upcoming clips at their first frame
    const horizon = frame + PRELOAD_SECONDS * fps;
    for (const clip of project.clips) {
      if (needed.has(clip.id) || clip.start <= frame || clip.start > horizon) continue;
      const media = this.mediaFor(clip);
      if (!media) continue;
      const first = sourceTime(project, clip, clip.start);
      if (!media.element.paused) media.element.pause();
      if (Math.abs(media.element.currentTime - first) > 0.05) media.element.currentTime = first;
    }

    // Quiet and stop the rest; drop long-unused ones
    const now = performance.now();
    for (const [clipId, media] of this.media) {
      const clip = project.clips.find((item) => item.id === clipId);
      const upcoming = clip && clip.start > frame && clip.start <= horizon;
      if (needed.has(clipId) || upcoming) continue;
      if (!media.element.paused) media.element.pause();
      if (media.gain && this.context) media.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
      if (!clip || now - media.usedAt > RELEASE_MS) this.release(clipId);
    }

    return layers;
  }

  private draw(frame: number) {
    const layers = this.sync(frame);
    const items: RenderItem[] = layers.map((layer) => {
      if (layer.kind === "video") {
        const element = this.media.get(layer.clip.id)?.element as HTMLVideoElement | undefined;
        const ready = element && element.readyState >= 2;
        return {
          layer,
          source: ready ? element : null,
          sourceWidth: element?.videoWidth ?? 0,
          sourceHeight: element?.videoHeight ?? 0,
        };
      }
      if (layer.kind === "image") {
        const bitmap = this.imageFor(layer.clip.assetId);
        return { layer, source: bitmap, sourceWidth: bitmap?.width ?? 0, sourceHeight: bitmap?.height ?? 0 };
      }
      return { layer, source: null, sourceWidth: 0, sourceHeight: 0 };
    });

    this.compositor.render(items, this.project.background);
  }

  // Redraw once on the next animation frame (paused)
  requestRender() {
    if (this.renderQueued || this.playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.playing) this.draw(Math.floor(this.frameValue));
    });
  }

  // ---------- Transport ----------

  seek(frame: number) {
    const end = Math.max(0, projectDuration(this.project) - 1);
    this.frameValue = Math.min(Math.max(0, Math.round(frame)), Math.max(end, 0));
    if (this.playing) {
      this.startFrame = this.frameValue;
      this.startClock = this.clock();
    }
    this.onFrame(this.frameValue);
    if (!this.playing) this.requestRender();
  }

  // The system clock: the AudioContext's stands still
  // when there's no audio output (and elements are kept
  // in step with this one anyway)
  private clock() {
    return performance.now() / 1000;
  }

  // `rate`: 1 normal; 2 and 4 fast forward (L)
  play(rate = 1) {
    const context = this.ensureAudio();
    void context.resume();

    const end = projectDuration(this.project);
    if (end <= 0) return;
    if (this.frameValue >= end - 1) this.frameValue = 0;

    this.rate = rate;
    this.startFrame = this.frameValue;
    this.startClock = this.clock();

    if (!this.playing) {
      this.playing = true;
      this.onPlayingChange(true);
      const tick = () => {
        if (!this.playing) return;
        const elapsed = this.clock() - this.startClock;
        const frame = this.startFrame + elapsed * this.project.fps * this.rate;
        const last = projectDuration(this.project) - 1;

        if (frame >= last) {
          this.frameValue = Math.max(0, last);
          this.pause();
          this.onFrame(this.frameValue);
          return;
        }

        this.frameValue = frame;
        this.draw(Math.floor(frame));
        this.onFrame(frame);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.frameValue = Math.floor(this.frameValue);
    for (const media of this.media.values()) {
      media.element.pause();
      if (media.gain && this.context) media.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
    }
    this.onPlayingChange(false);
    this.requestRender();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  // A still of the current frame (for the project poster)
  snapshot(type = "image/jpeg"): Promise<Blob | null> {
    this.draw(Math.floor(this.frameValue));
    const canvas = this.compositor.canvas as HTMLCanvasElement;
    return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  }

  dispose() {
    this.pause();
    for (const clipId of [...this.media.keys()]) this.release(clipId);
    for (const image of this.images.values()) if (image instanceof ImageBitmap) image.close();
    this.parking.remove();
    this.compositor.dispose();
    void this.context?.close();
  }
}

// Frames of a clip that a player at `frame` would show
export const clipVisibleAt = (clip: Clip, frame: number) => frame >= clip.start && frame < clipEnd(clip);

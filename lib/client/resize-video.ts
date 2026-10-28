import { fitVideo, videoLengthProblem, type VideoLimits } from "@/lib/higgsfield/models";

// --------------------------------------------------
// RESIZE A VIDEO IN THE BROWSER (before upload)
//
// For models with size limits (Seedance: see
// lib/higgsfield/models.ts). The video plays once,
// unseen and unheard, while each frame is drawn at the
// new size and recorded as MP4 with its sound, so it
// takes about as long as the clip. Same shape, so
// nothing is cropped or stretched.
//
// A hidden tab gets no frames to draw, which used to cut
// the video short: resizing now pauses while the tab is
// hidden, and a result shorter than the original is
// refused rather than uploaded.
// --------------------------------------------------

// High enough that a small resize doesn't lose detail
const BITS_PER_SECOND = 8_000_000;
const FRAME_RATE = 30;
// How much shorter than the original a result may be
// (encoders round the last frame)
const LENGTH_TOLERANCE_SECONDS = 0.35;

// A recording's length. Browser recordings often report
// Infinity until asked for a point past the end.
function measureDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.preload = "metadata";
    video.muted = true;
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) return done(video.duration);
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        done(Number.isFinite(video.duration) ? video.duration : null);
      };
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };
    video.src = url;
  });
}

// MP4 recording: Chrome, Edge and Safari
const MP4_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.4d002a,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

function mp4Type(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MP4_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

// The video's own size and length, from its metadata (a
// file, or a link: only the start of it is read). The
// length can be NaN or Infinity for some recordings.
function readVideoSize(
  source: File | string
): Promise<{ width: number; height: number; seconds: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const done = (size: { width: number; height: number; seconds: number } | null) => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(size);
    };

    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(
        video.videoWidth && video.videoHeight
          ? { width: video.videoWidth, height: video.videoHeight, seconds: video.duration }
          : null
      );
    video.onerror = () => done(null);
    video.src = url;
  });
}

export type ResizeCheck =
  | { action: "keep" }
  | { action: "resize"; width: number; height: number; from: { width: number; height: number; seconds: number } }
  | { action: "refuse"; error: string };

// What to do with this video for these limits
export async function checkVideo(source: File | string, limits: VideoLimits): Promise<ResizeCheck> {
  const size = await readVideoSize(source);
  // Can't tell: let the server's check decide
  if (!size) return { action: "keep" };

  const length = videoLengthProblem(size.seconds, limits);
  if (length) return { action: "refuse", error: length };

  const fit = fitVideo(size.width, size.height, limits);
  if (fit.ok) return { action: "keep" };
  if ("error" in fit) return { action: "refuse", error: fit.error };

  if (!mp4Type()) {
    return {
      action: "refuse",
      error: `This video is ${size.width}×${size.height}, which this model doesn't accept, and this browser can't resize it. Use Chrome, Edge or Safari, or resize it to ${fit.resize.width}×${fit.resize.height} and upload it again.`,
    };
  }

  return { action: "resize", ...fit.resize, from: size };
}

// The file redrawn at width × height (MP4). onProgress
// gets 0–100 as it plays through.
export function resizeVideo(
  file: File,
  width: number,
  height: number,
  onProgress?: (percent: number) => void
): Promise<File> {
  const type = mp4Type();
  if (!type) return Promise.reject(new Error("This browser can't resize videos."));

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    let audio: AudioContext | null = null;
    let stopped = false;
    // A frame callback is waiting (so resuming doesn't
    // start a second drawing loop)
    let scheduled = false;
    let onVisibility: (() => void) | null = null;

    const cleanup = () => {
      stopped = true;
      video.pause();
      URL.revokeObjectURL(url);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      void audio?.close().catch(() => {});
    };

    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };

    if (!context) return fail("Couldn't resize the video.");

    video.src = url;
    video.playsInline = true;
    video.preload = "auto";

    video.onerror = () => fail("Couldn't read this video to resize it.");

    video.onloadedmetadata = async () => {
      const stream = canvas.captureStream(FRAME_RATE);

      // The sound, routed into the recording only (never
      // to the speakers)
      try {
        audio = new AudioContext();
        const source = audio.createMediaElementSource(video);
        const destination = audio.createMediaStreamDestination();
        source.connect(destination);
        destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      } catch {
        // No audio track, or it can't be captured: video only
      }

      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITS_PER_SECOND });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => fail("Couldn't resize the video.");
      const sourceSeconds = video.duration;

      recorder.onstop = async () => {
        cleanup();
        const name = file.name.replace(/\.[^.]+$/, "") || "video";
        const result = new File(chunks, `${name}-${width}x${height}.mp4`, { type: "video/mp4" });

        // Never upload a video cut short
        const seconds = await measureDuration(result);
        if (
          Number.isFinite(sourceSeconds) &&
          seconds !== null &&
          seconds < sourceSeconds - LENGTH_TOLERANCE_SECONDS
        ) {
          reject(
            new Error(
              `Resizing the video went wrong (it came out ${seconds.toFixed(1)} s instead of ${sourceSeconds.toFixed(1)} s). Please try again and keep this tab in front until it's done.`
            )
          );
          return;
        }

        resolve(result);
      };

      const schedule = () => {
        if (scheduled || stopped || document.hidden) return;
        scheduled = true;
        if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(draw);
        else requestAnimationFrame(draw);
      };

      function draw() {
        scheduled = false;
        if (stopped) return;
        context!.drawImage(video, 0, 0, width, height);
        if (video.duration) onProgress?.(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
        schedule();
      }

      // Hidden tab: no frames would be drawn, so pause
      // everything and carry on when it's back in front
      onVisibility = () => {
        if (stopped) return;
        if (document.hidden) {
          video.pause();
          if (recorder.state === "recording") recorder.pause();
          return;
        }
        if (recorder.state === "paused") recorder.resume();
        void video.play().catch(() => fail("Couldn't continue resizing the video. Please try again."));
        schedule();
      };
      document.addEventListener("visibilitychange", onVisibility);

      video.onended = () => {
        context.drawImage(video, 0, 0, width, height);
        onProgress?.(100);
        if (recorder.state !== "inactive") recorder.stop();
      };

      try {
        await audio?.resume();
        // First frame before recording starts, so it
        // doesn't begin on a blank canvas
        context.drawImage(video, 0, 0, width, height);
        recorder.start(1000);
        await video.play();
        if (document.hidden) onVisibility();
        else schedule();
      } catch {
        fail("Couldn't play the video to resize it. Try again with this tab in front.");
      }
    };
  });
}

// A video already in the form (picked from the library,
// kept from an earlier upload, or from "Run again") that
// the model would refuse: downloaded, resized and
// uploaded again. Null when it already fits (or can't be
// read; the server's check then decides).
export async function fitVideoAt(
  url: string,
  limits: VideoLimits,
  upload: (file: File) => Promise<string>,
  onStatus: (status: string) => void
): Promise<{ url: string; note: string } | null> {
  const check = await checkVideo(url, limits);
  if (check.action === "keep") return null;
  if (check.action === "refuse") throw new Error(check.error);

  onStatus("Resizing video…");
  let original: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    original = await response.blob();
  } catch {
    throw new Error(
      `This video is ${check.from.width}×${check.from.height}, which this model doesn't accept, and it couldn't be fetched to resize it. Upload it again from this page and it will be resized.`
    );
  }

  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "video.mp4");
  const resized = await resizeVideo(
    new File([original], name, { type: original.type || "video/mp4" }),
    check.width,
    check.height
  );

  onStatus("Uploading resized video…");
  return {
    url: await upload(resized),
    note: `Resized from ${check.from.width}×${check.from.height} to ${check.width}×${check.height} so this model accepts it`,
  };
}

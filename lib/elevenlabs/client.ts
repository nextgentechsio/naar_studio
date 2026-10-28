import { findElevenLabsModel, MAX_MUSIC_SECONDS, type Voice } from "@/lib/elevenlabs/models";
import { fetchAllowed } from "@/lib/storage/output-source";

// --------------------------------------------------
// ELEVENLABS API (server only)
//
// Calls ElevenLabs with ELEVENLABS_API_KEY, which never
// leaves the server. Every tool answers with the audio
// itself (no job to poll), always asked for as 128 kbps
// MP3 so its length, and so its price, follows from its
// size (see audioSeconds). ELEVENLABS_API_URL points at a
// stand-in in the integration tests.
// --------------------------------------------------

const DEFAULT_API_URL = "https://api.elevenlabs.io";
const OUTPUT_FORMAT = "mp3_44100_128";
const BITS_PER_SECOND = 128_000;

// Long enough for a 5-minute song
const RUN_TIMEOUT_MS = 280_000;
const VOICES_TTL_MS = 10 * 60 * 1000;
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

function apiUrl(): string {
  return (process.env.ELEVENLABS_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", ...extra };
}

// A failed request, with ElevenLabs' own message when it
// gave one (never the request itself: it holds the key)
export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  get keyRejected() {
    return this.status === 401 || this.status === 403;
  }
}

async function errorFrom(response: Response): Promise<ElevenLabsError> {
  const body = (await response.json().catch(() => null)) as {
    detail?: { message?: string; status?: string } | { msg?: string }[] | string;
  } | null;
  const detail = body?.detail;

  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item.msg).filter(Boolean).join("; ")
        : detail?.message || detail?.status || "";

  if (response.status === 401 || response.status === 403) {
    return new ElevenLabsError(
      response.status,
      "ElevenLabs rejected the server's API key. An admin needs to update ELEVENLABS_API_KEY.",
    );
  }

  return new ElevenLabsError(response.status, message || `ElevenLabs couldn't make this (${response.status}).`);
}

// --------------------------------------------------
// VOICES
// --------------------------------------------------

const globalForVoices = globalThis as unknown as {
  elevenLabsVoices?: { at: number; voices: Promise<Voice[]> };
};

async function fetchVoices(): Promise<Voice[]> {
  const response = await fetch(`${apiUrl()}/v1/voices`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);

  const data = (await response.json()) as {
    voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[];
  };

  return (data.voices ?? [])
    .filter((voice) => voice.voice_id && voice.name)
    .map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      // "female, american, young", or "cloned"
      description:
        voice.category === "cloned" || voice.category === "professional"
          ? "your voice"
          : [voice.labels?.gender, voice.labels?.accent, voice.labels?.age].filter(Boolean).join(", "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listVoices(): Promise<Voice[]> {
  const cached = globalForVoices.elevenLabsVoices;

  if (!cached || Date.now() - cached.at > VOICES_TTL_MS) {
    const voices = fetchVoices();
    globalForVoices.elevenLabsVoices = { at: Date.now(), voices };
    voices.catch(() => {
      if (globalForVoices.elevenLabsVoices?.voices === voices) globalForVoices.elevenLabsVoices = undefined;
    });
  }

  return globalForVoices.elevenLabsVoices!.voices;
}

// --------------------------------------------------
// RUNS
// --------------------------------------------------

// Seconds of 128 kbps MP3 in this many bytes
export function audioSeconds(bytes: number): number {
  return Math.round(((bytes * 8) / BITS_PER_SECOND) * 100) / 100;
}

// Recordings for the voice changer: only from this app's
// own storage (Vercel Blob; the stand-in in tests)
function isStoredInput(url: URL): boolean {
  if (url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com")) return true;
  const base = process.env.VERCEL_BLOB_API_URL;
  if (!base) return false;
  try {
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

async function readInput(value: unknown): Promise<Blob> {
  let url: URL;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new ElevenLabsError(400, "Add a recording to re-voice.");
  }
  if (!isStoredInput(url)) {
    throw new ElevenLabsError(400, "The recording must be uploaded here first.");
  }

  const response = await fetchAllowed(url, isStoredInput, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new ElevenLabsError(400, "Couldn't read the recording. Upload it again.");
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new ElevenLabsError(400, "Recordings must be 50 MB or smaller.");

  return new Blob([bytes], { type: response.headers.get("content-type") || "audio/mpeg" });
}

const number = (value: unknown) => (value === "" || value === null || value === undefined ? undefined : Number(value));

// Runs a model and returns the audio it made
export async function runElevenLabs(
  id: string,
  input: Record<string, unknown>,
): Promise<{ bytes: Buffer; contentType: string }> {
  const item = findElevenLabsModel(id);
  if (!item) throw new ElevenLabsError(400, "Unknown ElevenLabs model");

  const query = `?output_format=${OUTPUT_FORMAT}`;
  const json = (body: Record<string, unknown>) => ({
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  let url: string;
  let init: RequestInit;

  if (item.tool === "tts") {
    url = `${apiUrl()}/v1/text-to-speech/${encodeURIComponent(String(input.voice_id ?? ""))}${query}`;
    init = json({
      text: String(input.prompt ?? ""),
      model_id: item.modelId,
      voice_settings: {
        stability: number(input.stability) ?? 0.5,
        similarity_boost: number(input.similarity_boost) ?? 0.75,
        style: number(input.style) ?? 0,
        speed: number(input.speed) ?? 1,
      },
    });
  } else if (item.tool === "sound") {
    url = `${apiUrl()}/v1/sound-generation${query}`;
    init = json({
      text: String(input.prompt ?? ""),
      model_id: item.modelId,
      loop: Boolean(input.loop),
      ...(number(input.duration_seconds) !== undefined && { duration_seconds: number(input.duration_seconds) }),
      ...(number(input.prompt_influence) !== undefined && { prompt_influence: number(input.prompt_influence) }),
    });
  } else if (item.tool === "music") {
    const seconds = Math.min(MAX_MUSIC_SECONDS, Math.max(3, Number(input.duration) || 30));
    url = `${apiUrl()}/v1/music${query}`;
    init = json({
      prompt: String(input.prompt ?? ""),
      model_id: item.modelId,
      music_length_ms: Math.round(seconds * 1000),
      force_instrumental: Boolean(input.force_instrumental),
    });
  } else {
    const form = new FormData();
    form.append("audio", await readInput(input.audio_url), "recording");
    form.append("model_id", item.modelId);
    form.append("remove_background_noise", String(Boolean(input.remove_background_noise)));
    url = `${apiUrl()}/v1/voice-changer/${encodeURIComponent(String(input.voice_id ?? ""))}${query}`;
    init = { method: "POST", headers: headers(), body: form };
  }

  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
  if (!response.ok) throw await errorFrom(response);

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: "audio/mpeg",
  };
}

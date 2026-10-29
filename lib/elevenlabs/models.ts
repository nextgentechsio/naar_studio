import type { Schema } from "@/app/(studio)/_generate/fields";
import type { HiggsfieldCategory, HiggsfieldModel } from "@/lib/higgsfield/models";

// --------------------------------------------------
// ELEVENLABS MODELS (shared by server and browser)
//
// ElevenLabs' audio tools, as models the Generate page can
// show: text to speech, sound effects, music and the voice
// changer. Each has its form (built here, with the voices
// the server lists) and its price, from ElevenLabs' API
// price list (elevenlabs.io/pricing/api):
//
//   text to speech  per 1,000 characters of text
//   sound effects   per minute of audio made
//   music           per minute of audio made
//   voice changer   per minute of audio made
//
// No API calls or credentials here: the browser imports
// this. Calls are in lib/elevenlabs/client.ts.
// --------------------------------------------------

export type ElevenLabsTool = "tts" | "sound" | "music" | "voice-changer";

type ToolModel = {
  // "tts/eleven_multilingual_v2": tool / ElevenLabs model_id
  id: string;
  tool: ElevenLabsTool;
  modelId: string;
  // Models of one tool share a title; the task names the version
  title: string;
  task: string;
  description: string;
  // USD per 1,000 characters (text to speech) or per minute
  rate: number;
};

const TOOL_INFO: Record<ElevenLabsTool, { title: string; category: HiggsfieldCategory }> = {
  tts: { title: "Text to speech", category: "text-to-speech" },
  sound: { title: "Sound effects", category: "sound-effects" },
  music: { title: "Music", category: "music" },
  "voice-changer": { title: "Voice changer", category: "voice-changer" },
};

const tool = (
  kind: ElevenLabsTool,
  modelId: string,
  task: string,
  description: string,
  rate: number,
): ToolModel => ({
  id: `${kind}/${modelId}`,
  tool: kind,
  modelId,
  title: TOOL_INFO[kind].title,
  task,
  description,
  rate,
});

export const ELEVENLABS_MODELS: ToolModel[] = [
  tool("tts", "eleven_multilingual_v2", "Multilingual v2", "Natural, consistent speech in 29 languages", 0.08),
  tool("tts", "eleven_v3", "Eleven v3", "The most expressive voices, with audio tags like [laughs]", 0.08),
  tool("tts", "eleven_flash_v2_5", "Flash v2.5", "Fastest and half the price, 32 languages", 0.04),
  tool("tts", "eleven_turbo_v2_5", "Turbo v2.5", "Fast, half the price, good quality", 0.04),
  tool("sound", "eleven_text_to_sound_v2", "Sound effects v2", "Any sound from a description, up to 30 seconds", 0.12),
  tool("sound", "eleven_text_to_sound_v3", "Sound effects v3", "Newer sound model, up to 30 seconds", 0.12),
  tool("music", "music_v2_5", "Eleven Music v2.5", "Songs and instrumentals from a description", 0.15),
  tool("music", "music_v1", "Eleven Music v1", "The first music model", 0.15),
  tool("voice-changer", "eleven_multilingual_sts_v2", "Multilingual", "Re-voice a recording, keeping its delivery", 0.12),
  tool("voice-changer", "eleven_english_sts_v2", "English", "Re-voice an English recording", 0.12),
];

export function findElevenLabsModel(id: string): ToolModel | null {
  return ELEVENLABS_MODELS.find((item) => item.id === id) ?? null;
}

// As the model pickers list models
export function elevenLabsModelInfo(item: ToolModel): HiggsfieldModel {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    output: "audio",
    category: TOOL_INFO[item.tool].category,
    task: item.task,
    workflow: false,
  };
}

// Longest music track offered (ElevenLabs allows 10
// minutes; a run must finish within the server's time
// limit)
export const MAX_MUSIC_SECONDS = 300;

// `preview`: a short sample of the voice ("" if none)
export type Voice = { id: string; name: string; description: string; preview?: string };

// The model's form. Voices come from the account (the
// server lists them); the first is the default.
export function elevenLabsSchema(item: ToolModel, voices: Voice[]): Schema {
  const voice = {
    type: "string",
    title: "Voice",
    description: "Any voice in the ElevenLabs account, including your own clones.",
    enum: voices.map((entry) => entry.id),
    enumLabels: Object.fromEntries(
      voices.map((entry) => [entry.id, entry.description ? `${entry.name} · ${entry.description}` : entry.name]),
    ),
    enumPreviews: Object.fromEntries(
      voices.filter((entry) => entry.preview).map((entry) => [entry.id, entry.preview!]),
    ),
    default: voices[0]?.id,
  };
  const slider = (title: string, description: string, def: number, min = 0, max = 1) => ({
    type: "number",
    title,
    description,
    default: def,
    minimum: min,
    maximum: max,
    "x-advanced": true,
  });

  if (item.tool === "tts") {
    return {
      prompt: { type: "string", title: "Text", description: "What the voice says. Billed per character." },
      voice_id: voice,
      speed: { type: "number", title: "Speed", description: "0.7 (slower) to 1.2 (faster).", default: 1, minimum: 0.7, maximum: 1.2 },
      stability: slider("Stability", "Higher is steadier; lower is more expressive.", 0.5),
      similarity_boost: slider("Similarity", "How closely to match the original voice.", 0.75),
      style: slider("Style", "Exaggerates the voice's style. Adds latency above 0.", 0),
    };
  }

  if (item.tool === "sound") {
    return {
      prompt: { type: "string", title: "Description", description: "The sound to make, e.g. \"rain on a tin roof, distant thunder\"." },
      duration_seconds: {
        type: "number",
        title: "Duration",
        description: "Seconds, 0.5 to 30. Leave empty to let the model choose.",
        minimum: 0.5,
        maximum: 30,
      },
      loop: { type: "boolean", title: "Loop", description: "Make it loop smoothly.", default: false },
      prompt_influence: slider("Prompt influence", "Higher follows the description more closely.", 0.3),
    };
  }

  if (item.tool === "music") {
    return {
      prompt: { type: "string", title: "Description", description: "Style, mood, instruments, lyrics topic…" },
      duration: {
        type: "integer",
        title: "Duration",
        description: `Seconds, 3 to ${MAX_MUSIC_SECONDS}.`,
        default: 30,
        minimum: 3,
        maximum: MAX_MUSIC_SECONDS,
      },
      force_instrumental: { type: "boolean", title: "Instrumental", description: "No vocals.", default: false },
    };
  }

  return {
    audio_url: { type: "string", format: "uri", title: "Recording", description: "The speech to re-voice (its words, timing and emotion are kept)." },
    voice_id: voice,
    remove_background_noise: {
      type: "boolean",
      title: "Remove background noise",
      description: "Clean up the recording first.",
      default: false,
    },
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

// A run's price: exact for text to speech (the text is
// known), from the requested length for music and sound
// effects, and from the audio made once it's known.
// Null when it can't be known yet.
export function elevenLabsCostUsd(
  id: string,
  input: Record<string, unknown>,
  outputSeconds?: number | null,
): number | null {
  const item = findElevenLabsModel(id);
  if (!item) return null;

  if (item.tool === "tts") {
    const text = typeof input.prompt === "string" ? input.prompt : "";
    return round4((text.length / 1000) * item.rate);
  }

  let seconds: number | null = outputSeconds ?? null;
  if (seconds === null && item.tool === "music") seconds = Number(input.duration) || null;
  if (seconds === null && item.tool === "sound") seconds = Number(input.duration_seconds) || null;

  return seconds && seconds > 0 ? round4((seconds / 60) * item.rate) : null;
}

// Whether elevenLabsCostUsd's figure before the run is the
// final price (text to speech is billed by the text)
export function elevenLabsPriceIsExact(id: string): boolean {
  return findElevenLabsModel(id)?.tool === "tts";
}

// "$0.08 / 1K characters", "$0.12 / min"
export function elevenLabsPriceHint(id: string): string | null {
  const item = findElevenLabsModel(id);
  if (!item) return null;
  return item.tool === "tts" ? `$${item.rate.toFixed(2)} / 1K characters` : `$${item.rate.toFixed(2)} / min`;
}

import { describe, expect, it } from "vitest";
import { audioSeconds } from "@/lib/elevenlabs/client";
import { elevenLabsCostUsd, elevenLabsPriceHint, elevenLabsPriceIsExact } from "@/lib/elevenlabs/models";

// ElevenLabs' API prices (elevenlabs.io/pricing/api)
describe("ElevenLabs prices", () => {
  it("bills speech by the characters, by model", () => {
    const text = "x".repeat(1000);
    expect(elevenLabsCostUsd("tts/eleven_multilingual_v2", { prompt: text })).toBe(0.08);
    expect(elevenLabsCostUsd("tts/eleven_v3", { prompt: text })).toBe(0.08);
    expect(elevenLabsCostUsd("tts/eleven_flash_v2_5", { prompt: text })).toBe(0.04);
    expect(elevenLabsPriceIsExact("tts/eleven_flash_v2_5")).toBe(true);
  });

  it("bills sound, music and the voice changer by the minute of audio", () => {
    expect(elevenLabsCostUsd("sound/eleven_text_to_sound_v2", { duration_seconds: 30 })).toBe(0.06);
    expect(elevenLabsCostUsd("music/music_v2_5", { duration: 120 })).toBe(0.3);
    // Unknown until the audio exists
    expect(elevenLabsCostUsd("sound/eleven_text_to_sound_v2", {})).toBeNull();
    expect(elevenLabsCostUsd("voice-changer/eleven_multilingual_sts_v2", {})).toBeNull();
    // Then measured: what was made wins
    expect(elevenLabsCostUsd("voice-changer/eleven_multilingual_sts_v2", {}, 90)).toBe(0.18);
    expect(elevenLabsCostUsd("music/music_v2_5", { duration: 120 }, 119.5)).toBe(0.2988);
    expect(elevenLabsPriceIsExact("music/music_v2_5")).toBe(false);
  });

  it("measures 128 kbps MP3 by its size, and labels prices", () => {
    expect(audioSeconds(16_000)).toBe(1);
    expect(audioSeconds(480_000)).toBe(30);
    expect(elevenLabsPriceHint("tts/eleven_multilingual_v2")).toBe("$0.08 / 1K characters");
    expect(elevenLabsPriceHint("music/music_v2_5")).toBe("$0.15 / min");
    expect(elevenLabsCostUsd("nope", { prompt: "x" })).toBeNull();
  });
});

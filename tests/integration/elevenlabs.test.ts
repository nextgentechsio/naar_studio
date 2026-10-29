import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import {
  api,
  closeDb,
  createProject,
  createUser,
  db,
  loginRoot,
  replicateRequests,
  replicateUrl,
  type Session,
} from "./helpers";

// --------------------------------------------------
// ElevenLabs: its four tools as models, runs done by the
// server (recorded, saved, costed), polled like the other
// platforms. Against a stand-in ElevenLabs (never the
// real, billable one) that answers with 128 kbps MP3s of
// a known length.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const start = (model: string, inputs: Record<string, unknown>, session: Session | null = alice.session) =>
  api("/api/elevenlabs/generate", { session, json: { project: project.name, model, inputs } });

// Polls until the run is done (the server finishes it
// after answering)
async function finished(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await api(`/api/predictions/${encodeURIComponent(id)}`, { session: alice.session });
    const status = String(result.data.status);
    if (["succeeded", "failed"].includes(status)) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${id} never finished`);
}

async function run(model: string, inputs: Record<string, unknown>) {
  const started = await start(model, inputs);
  expect(started.status, JSON.stringify(started.data)).toBe(200);
  const id = (started.data.tracking as { predictionId: string }).predictionId;
  return { id, started, done: await finished(id) };
}

describe("ElevenLabs", () => {
  it("lists its tools and builds each form with the account's voices", async () => {
    const list = await api("/api/elevenlabs/models", { session: alice.session });
    expect(list.data.enabled).toBe(true);
    const ids = (list.data.models as { id: string; output: string; category: string }[]).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([
      "tts/eleven_multilingual_v2",
      "sound/eleven_text_to_sound_v2",
      "music/music_v2_5",
      "voice-changer/eleven_multilingual_sts_v2",
    ]));
    expect((list.data.models as { output: string }[]).every((item) => item.output === "audio")).toBe(true);

    const tts = await api("/api/elevenlabs/models/schema?model=tts/eleven_multilingual_v2", { session: alice.session });
    const voice = (tts.data.inputSchema as Record<string, { enum?: string[]; enumLabels?: Record<string, string>; default?: string }>).voice_id;
    // Sorted by name; clones marked as yours
    expect(voice.enum).toEqual(["voice-adam", "voice-mine", "voice-rachel"]);
    expect(voice.enumLabels?.["voice-mine"]).toBe("My voice · your voice");
    expect(voice.default).toBe("voice-adam");
    // Only voices with a sample can be listened to
    expect((voice as { enumPreviews?: Record<string, string> }).enumPreviews).toEqual({
      "voice-rachel": "https://storage.example.com/voices/rachel.mp3",
    });

    const music = await api("/api/elevenlabs/models/schema?model=music/music_v2_5", { session: alice.session });
    expect(Object.keys(music.data.inputSchema as object)).toEqual(["prompt", "duration", "force_instrumental"]);

    expect((await api("/api/elevenlabs/models/schema?model=nope", { session: alice.session })).status).toBe(404);
    expect((await api("/api/elevenlabs/models")).status).toBe(401);
  });

  it("speaks text, saves the audio and bills it by the characters", async () => {
    const text = "Hello from NAAR Studio, this is a test.";
    const { id, started, done } = await run("tts/eleven_multilingual_v2", {
      prompt: text,
      voice_id: "voice-rachel",
      stability: 0.4,
      // Not this model's setting: dropped
      resolution: "1080p",
    });

    // The price is known before the run: 39 characters at $0.08 per 1,000
    expect(started.data.costUsd).toBe(0.0031);
    expect(done.data.status).toBe("succeeded");
    expect(done.data.costUsd).toBe(0.0031);

    // Saved here, served as audio
    const output = String(done.data.output);
    expect(output).toBe(`/api/generations/${id}/output`);
    const served = await api(output, { session: alice.session });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("audio/mpeg");

    // Can be kept in the library, as audio
    const kept = await api("/api/library/from-generation", { session: alice.session, json: { generationId: id } });
    expect(kept.data.file).toMatchObject({ kind: "audio", contentType: "audio/mpeg" });

    // What ElevenLabs was asked for
    const sent = (await replicateRequests()).filter((request) => request.path.startsWith("/el/v1/text-to-speech/voice-rachel")).at(-1);
    expect(sent?.path).toContain("output_format=mp3_44100_128");
    expect(sent?.body).toMatchObject({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4 } });
    expect(sent?.body).not.toHaveProperty("resolution");

    // Billed, as an ElevenLabs expense
    const expense = await (await db()).collection("expenses").findOne({ _id: id as never });
    expect(expense).toMatchObject({ provider: "elevenlabs", model: "tts/eleven_multilingual_v2", amountUsd: 0.0031 });
  });

  it("bills sound effects and music by the audio made", async () => {
    // 7 seconds at $0.12 a minute
    const sound = await run("sound/eleven_text_to_sound_v2", { prompt: "rain on a tin roof", duration_seconds: 7 });
    expect(sound.started.data.costUsd).toBe(0.014);
    expect(sound.done.data.costUsd).toBe(0.014);

    // No length asked for: the model picks (5 s here), so
    // the price is only known after
    const free = await run("sound/eleven_text_to_sound_v2", { prompt: "a door creaks" });
    expect(free.started.data.costUsd).toBeNull();
    expect(free.done.data.costUsd).toBe(0.01);

    // 45 seconds at $0.15 a minute, sent as milliseconds
    const music = await run("music/music_v2_5", { prompt: "calm piano", duration: 45 });
    expect(music.done.data.costUsd).toBe(0.1125);
    const sent = (await replicateRequests()).filter((request) => request.path.startsWith("/el/v1/music")).at(-1);
    expect(sent?.body).toMatchObject({ prompt: "calm piano", model_id: "music_v2_5", music_length_ms: 45000 });
  });

  it("re-voices a recording from the app's storage", async () => {
    const put = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent("library/voice.mp3")}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": "audio/mpeg" },
      body: new Uint8Array(32_000),
    });
    const recording = ((await put.json()) as { url: string }).url;

    // 3 seconds out at $0.12 a minute
    const { done } = await run("voice-changer/eleven_multilingual_sts_v2", {
      audio_url: recording,
      voice_id: "voice-adam",
      remove_background_noise: true,
    });
    expect(done.data.status).toBe("succeeded");
    expect(done.data.costUsd).toBe(0.006);

    // Recordings from anywhere else are refused
    const outside = await run("voice-changer/eleven_multilingual_sts_v2", {
      audio_url: "https://example.com/voice.mp3",
      voice_id: "voice-adam",
    });
    expect(outside.done.data.status).toBe("failed");
    expect(String(outside.done.data.error)).toMatch(/uploaded here first/);
  });

  it("records ElevenLabs' refusal as a failed, unbilled run", async () => {
    const { id, done } = await run("tts/eleven_flash_v2_5", { prompt: "something moderated", voice_id: "voice-adam" });
    expect(done.data.status).toBe("failed");
    expect(done.data.error).toBe("This request was blocked by moderation.");
    expect(await (await db()).collection("expenses").findOne({ _id: id as never })).toBeNull();
  });

  it("refuses bad requests before calling ElevenLabs", async () => {
    const before = (await replicateRequests()).filter((request) => request.path.startsWith("/el/") && request.method === "POST").length;

    expect((await start("tts/eleven_multilingual_v2", { prompt: "  ", voice_id: "voice-adam" })).status).toBe(400);
    expect((await start("tts/eleven_multilingual_v2", { prompt: "hi" })).status).toBe(400);
    expect((await start("voice-changer/eleven_multilingual_sts_v2", { voice_id: "voice-adam" })).status).toBe(400);
    expect((await start("tts/eleven_multilingual_v2", { prompt: "x".repeat(10_001), voice_id: "voice-adam" })).status).toBe(400);
    expect((await start("nope/nope", { prompt: "hi" })).status).toBe(400);
    expect((await start("tts/eleven_multilingual_v2", { prompt: "hi", voice_id: "voice-adam" }, null)).status).toBe(401);
    expect((await api("/api/elevenlabs/generate", { session: alice.session, json: { project: "No such project", model: "tts/eleven_multilingual_v2", inputs: { prompt: "hi", voice_id: "voice-adam" } } })).status).toBe(400);

    const after = (await replicateRequests()).filter((request) => request.path.startsWith("/el/") && request.method === "POST").length;
    expect(after).toBe(before);
  });

  it("shows up as its own platform in History and the analytics", async () => {
    const runs = await api(`/api/generations?options=0&pageSize=60&project=${project.id}&provider=elevenlabs`, { session: alice.session });
    const listed = runs.data.generations as { provider: string }[];
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((item) => item.provider === "elevenlabs")).toBe(true);

    const replicateOnly = await api(`/api/generations?options=0&pageSize=60&project=${project.id}&provider=replicate`, { session: alice.session });
    expect(replicateOnly.data.generations).toEqual([]);

    const now = new Date();
    const analytics = await api(
      `/api/expenses/analytics?from=${new Date(now.getTime() - 86_400_000).toISOString()}&to=${new Date(now.getTime() + 60_000).toISOString()}&tz=UTC`,
      { session: alice.session },
    );
    const byProvider = analytics.data.byProvider as Record<string, { count: number; amountUsd: number }>;
    expect(byProvider.elevenlabs.count).toBeGreaterThanOrEqual(5);
    expect(byProvider.replicate.count).toBe(0);
  });
});

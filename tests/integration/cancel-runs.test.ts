import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createProject, createUser, db, loginRoot, replicateUrl, startGeneration, type Session } from "./helpers";

// --------------------------------------------------
// Cancelling a running generation on each platform, so
// it isn't billed further: Replicate (asked to stop),
// Higgsfield (only while queued), ElevenLabs (our own
// run, stopped mid-request). A canceled run keeps no
// output and adds no expense.
// --------------------------------------------------

let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  bob = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const cancel = (session: Session, id: string) =>
  api(`/api/predictions/${encodeURIComponent(id)}/cancel`, { session, method: "POST", json: {} });

const record = async (id: string) =>
  (await db()).collection("generations").findOne({ _id: id as never });

const expenses = async (id: string) => (await db()).collection("expenses").countDocuments({ _id: id as never });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cancel a run", () => {
  it("stops a Replicate run", async () => {
    const id = await startGeneration(alice.session, project.name, "google/nano-banana", { prompt: "stop me" });

    // Only its owner (or an admin)
    expect((await cancel(bob.session, id)).status).toBe(404);

    const canceled = await cancel(alice.session, id);
    expect(canceled.status, JSON.stringify(canceled.data)).toBe(200);
    expect(canceled.data.status).toBe("canceled");

    const polled = await api(`/api/predictions/${encodeURIComponent(id)}`, { session: alice.session });
    expect(polled.data.status).toBe("canceled");
    expect((await record(id))?.status).toBe("canceled");
    expect(await expenses(id)).toBe(0);

    // Already over
    expect((await cancel(alice.session, id)).status).toBe(409);
  });

  it("stops a Higgsfield run while it's queued, and says so once it has started", async () => {
    const start = () =>
      api("/api/higgsfield/generate", {
        session: alice.session,
        json: {
          project: project.name,
          model: "bytedance/seedance-2.5/text-to-video",
          inputs: { prompt: "A scene", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true },
        },
      });

    const queued = (await start()).data.tracking as { predictionId: string };
    const canceled = await cancel(alice.session, queued.predictionId);
    expect(canceled.status, JSON.stringify(canceled.data)).toBe(200);
    expect((await record(queued.predictionId))?.status).toBe("canceled");
    expect(await expenses(queued.predictionId)).toBe(0);

    const started = (await start()).data.tracking as { predictionId: string };
    await fetch(`${replicateUrl}/__control/hf/${encodeURIComponent(started.predictionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    const refused = await cancel(alice.session, started.predictionId);
    expect(refused.status).toBe(409);
    expect(String(refused.data.error)).toMatch(/already started/);
    expect((await record(started.predictionId))?.status).not.toBe("canceled");
  });

  it("stops an ElevenLabs run mid-request and keeps nothing", async () => {
    const started = await api("/api/elevenlabs/generate", {
      session: alice.session,
      json: { project: project.name, model: "sound/eleven_text_to_sound_v2", inputs: { prompt: "a slow storm" } },
    });
    expect(started.status, JSON.stringify(started.data)).toBe(200);
    const id = (started.data.tracking as { predictionId: string }).predictionId;

    const canceled = await cancel(alice.session, id);
    expect(canceled.data.status).toBe("canceled");

    // Past when the (slow) request would have finished
    await sleep(7000);
    const after = await record(id);
    expect(after?.status).toBe("canceled");
    expect(after?.localOutputUrl ?? null).toBeNull();
    expect(await expenses(id)).toBe(0);
  }, 20_000);
});

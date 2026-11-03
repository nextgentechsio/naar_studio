import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BLOB_TOKEN, FAKE_OUTPUT_MP4 } from "./fake-replicate";
import {
  closeDb,
  createProject,
  createUser,
  db,
  loginRoot,
  pollPrediction,
  replicateUrl,
  setPrediction,
  startGeneration,
} from "./helpers";

// --------------------------------------------------
// Topaz Video Upscale is priced by the video's length,
// which neither its inputs nor Replicate report: the
// app reads it from the input file in its own storage
// (e.g. a Higgsfield draft being upscaled).
// --------------------------------------------------

const TOPAZ = "topazlabs/video-upscale";

let alice: Awaited<ReturnType<typeof createUser>>;
let project: { name: string };

beforeAll(async () => {
  const root = await loginRoot();
  alice = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

async function storedVideo(name: string) {
  const response = await fetch(`${replicateUrl}/blob/?pathname=${encodeURIComponent(`library/${alice.id}/${name}`)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${FAKE_BLOB_TOKEN}`, "x-content-type": "video/mp4" },
    body: new Uint8Array(FAKE_OUTPUT_MP4),
  });
  return ((await response.json()) as { url: string }).url;
}

async function upscale(video: string, target_resolution: string) {
  const id = await startGeneration(alice.session, project.name, TOPAZ, { video, target_resolution, target_fps: 30 });
  await setPrediction(id, { status: "succeeded", output: `${replicateUrl}/__control/output.mp4` });
  await pollPrediction(alice.session, id);
  return (await db()).collection("generations").findOne({ _id: id as never });
}

describe("Topaz video upscale cost", () => {
  it("prices the run from the stored input video's length", async () => {
    // A 5 s video: $0.093 per 5 s at 1080p, $0.373 at 4K
    const video = await storedVideo("draft.mp4");

    expect(await upscale(video, "1080p")).toMatchObject({ status: "succeeded", costUsd: 0.093 });
    expect(await upscale(video, "4k")).toMatchObject({ costUsd: 0.373 });
  });

  it("records no price for a video it may not read", async () => {
    // Not this app's storage: never fetched, no guess
    expect(await upscale("https://example.com/clip.mp4", "1080p")).toMatchObject({
      status: "succeeded",
      costUsd: null,
    });
  });
});

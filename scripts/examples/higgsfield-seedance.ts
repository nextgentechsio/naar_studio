// --------------------------------------------------
// HIGGSFIELD EXAMPLE: Seedance 2.5 text-to-video
//
// Run with: npm run higgsfield:example
// (node --env-file=.env.local scripts/examples/higgsfield-seedance.ts)
//
// Needs HF_CREDENTIALS ("key-id:key-secret") in
// .env.local, which Git ignores. Server-side only: the
// SDK refuses to run in a browser. This makes a billable
// generation request.
// --------------------------------------------------

import {
  APIError,
  config,
  higgsfield,
  HiggsfieldError,
  type V2Response,
} from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

async function main() {
  if (!process.env.HF_CREDENTIALS) {
    throw new Error("HF_CREDENTIALS is not set in .env.local");
  }

  config({
    credentials: process.env.HF_CREDENTIALS,
    // Video takes a while; the SDK's default is 5 minutes
    maxPollTime: 15 * 60 * 1000,
  });

  console.log(`Submitting ${MODEL}…`);

  const result: V2Response = await higgsfield.subscribe(MODEL, {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
    withPolling: true,
  });

  // Only a completed request with a video counts. The
  // SDK also returns "failed" and "nsfw" (moderated), and
  // the API may report other states, e.g. canceled.
  const status: string = result.status;

  if (status !== "completed" || !result.video?.url) {
    const reason =
      status === "nsfw"
        ? "blocked by content moderation"
        : status === "failed"
          ? "the generation failed"
          : status === "canceled"
            ? "the request was canceled"
            : status === "completed"
              ? "completed without a video URL"
              : `ended with status "${status}"`;

    // The API explains failures in an "error" field the
    // SDK's types leave out (e.g. too few credits)
    const detail = (result as V2Response & { error?: unknown }).error;

    console.error(`Not generated (request ${result.request_id}): ${reason}.`);
    if (typeof detail === "string" && detail) console.error(detail);
    process.exitCode = 1;
    return;
  }

  console.log(`Request ${result.request_id} completed.`);
  console.log(`Video URL: ${result.video.url}`);
}

main().catch((error: unknown) => {
  // Name, message and status only: whole error objects can
  // carry request headers, which hold the credentials
  if (error instanceof APIError) {
    console.error(
      `Higgsfield API error${error.statusCode ? ` (${error.statusCode})` : ""}: ${error.message}`
    );
  } else if (error instanceof HiggsfieldError) {
    console.error(`${error.name}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : "Unknown error");
  }

  process.exitCode = 1;
});

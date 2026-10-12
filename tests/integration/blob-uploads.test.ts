import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayloadFromClientToken } from "@vercel/blob/client";
import { FAKE_BLOB_TOKEN } from "./fake-replicate";
import { api, closeDb, createUser, loginRoot, replicateUrl, type Session } from "./helpers";

// --------------------------------------------------
// Direct uploads to Vercel Blob: the app only hands out
// limited upload tokens, and deletes old uploads.
// --------------------------------------------------

let user: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  user = await createUser(await loginRoot(), "user");
});

afterAll(closeDb);

const DAY = 24 * 60 * 60 * 1000;

const requestToken = (session: Session | null, pathname: string, body?: unknown) =>
  api("/api/upload/blob", {
    session,
    json: body ?? {
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: null },
    },
  });

describe("direct uploads", () => {
  it("is reported as available to signed-in users only", async () => {
    expect((await api("/api/upload/blob", { session: user.session })).data).toEqual({ enabled: true });
    expect((await api("/api/upload/blob")).status).toBe(401);
  });

  it("hands out a short-lived token limited to media and 100 MB", async () => {
    const { status, data } = await requestToken(user.session, "inputs/photo.png");
    expect(status).toBe(200);

    const token = getPayloadFromClientToken(data.clientToken as string);
    expect(token).toMatchObject({
      pathname: "inputs/photo.png",
      maximumSizeInBytes: 100 * 1024 * 1024,
      allowedContentTypes: ["image/*", "video/*", "audio/*"],
      addRandomSuffix: true,
    });
    expect(token.validUntil - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    // No completion callback: Vercel never calls the app
    expect(token).not.toHaveProperty("onUploadCompleted");
  });

  it("refuses other paths, bad requests and signed-out users", async () => {
    expect((await requestToken(user.session, "outputs/x.png")).status).toBe(400);
    expect((await requestToken(user.session, "inputs/../x.png")).status).toBe(400);
    expect((await requestToken(user.session, "", { type: "blob.upload-completed", payload: {} })).status).toBe(400);
    expect((await requestToken(null, "inputs/a.png")).status).toBe(401);
  });

  it("deletes uploads older than 7 days", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = FAKE_BLOB_TOKEN;
    process.env.VERCEL_BLOB_API_URL = `${replicateUrl}/blob`;
    const { pruneOldInputs } = await import("@/lib/input-uploads");

    const blob = (name: string, days: number) => ({
      url: `https://store.public.blob.vercel-storage.com/${name}`,
      pathname: name,
      size: 10,
      uploadedAt: new Date(Date.now() - days * DAY).toISOString(),
    });

    await fetch(`${replicateUrl}/__control/blobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([blob("inputs/old.png", 8), blob("inputs/new.png", 6)]),
    });

    expect(await pruneOldInputs()).toBe(1);

    const state = await (await fetch(`${replicateUrl}/__control/blobs`)).json();
    expect(state.blobs.map((b: { pathname: string }) => b.pathname)).toEqual(["inputs/new.png"]);
    // Only ever lists our own folder
    expect(
      state.requests.filter((r: { method: string }) => r.method === "GET").every((r: { path: string }) =>
        r.path.includes("prefix=inputs%2F")
      )
    ).toBe(true);
  });
});

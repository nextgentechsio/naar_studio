import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, loginRoot, type Session } from "./helpers";

type Model = { id: string; approved: boolean; runCount: number; coverImageUrl: string | null };

let user: Session;

beforeAll(async () => {
  const root = await loginRoot();
  user = (await createUser(root, "user")).session;
});

afterAll(closeDb);

describe("model browser", () => {
  it("lists Replicate's categories, sorted by name", async () => {
    const { status, data } = await api("/api/models/collections", { session: user });
    expect(status).toBe(200);
    expect((data.collections as { slug: string }[]).map((item) => item.slug)).toEqual([
      "official",
      "upscale",
    ]);
  });

  it("lists a category's models: approved first, then most used", async () => {
    const { status, data } = await api("/api/models/collections/upscale", { session: user });
    expect(status).toBe(200);

    const models = data.models as Model[];
    expect(models.map((item) => item.id)).toEqual([
      "philz1337x/crystal-upscaler",
      "someone/big",
      "someone/small",
    ]);
    expect(models[0].approved).toBe(true);
    expect(models[1].approved).toBe(false);
  });

  it("rejects odd category names and reports missing ones", async () => {
    for (const slug of ["..%2Faccount", "UPPER", "a%20b"]) {
      expect((await api(`/api/models/collections/${slug}`, { session: user })).status, slug).toBe(400);
    }
    expect((await api("/api/models/collections/missing", { session: user })).status).toBe(404);
  });

  it("searches all of Replicate with the same shape", async () => {
    const { data } = await api("/api/models/search?q=anything", { session: user });
    const models = data.models as Model[];

    expect(models.map((item) => item.id)).toEqual([
      "google/nano-banana",
      "fake/popular",
      "fake/rare",
    ]);
    // Non-https preview images are dropped
    expect(models[1].coverImageUrl).toBeNull();
  });

  it("is for signed-in users only", async () => {
    expect((await api("/api/models/collections")).status).toBe(401);
    expect((await api("/api/models/collections/upscale")).status).toBe(401);
  });
});

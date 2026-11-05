import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createProject, createUser, db, loginRoot, type Session } from "./helpers";

// --------------------------------------------------
// Per-user platform access: admins choose which Create
// platforms each account may use; the server refuses the
// rest, whatever the browser sends.
// --------------------------------------------------

const ALL = ["replicate", "higgsfield", "elevenlabs", "catalogue"];

let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let user: Awaited<ReturnType<typeof createUser>>;
let project: { id: string; name: string };

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  user = await createUser(root, "user");
  project = await createProject(root);
});

afterAll(closeDb);

const me = async (session: Session) => (await api("/api/auth/me", { session })).data.user as { platforms: string[] };
const setPlatforms = (session: Session, id: string, platforms: unknown) =>
  api(`/api/users/${id}`, { session, method: "PATCH", json: { platforms } });
const stored = async (id: string) => (await (await db()).collection("users").findOne({ _id: id as never }))?.platforms;

const startReplicate = (session: Session) =>
  api("/api/generate", { session, json: { project: project.name, model: "someone/unlisted", inputs: { prompt: "x" } } });
const startElevenLabs = (session: Session) =>
  api("/api/elevenlabs/generate", {
    session,
    json: { project: project.name, model: "tts/eleven_multilingual_v2", inputs: { prompt: "hi", voice_id: "voice-adam" } },
  });

describe("platform access", () => {
  it("gives every account every platform until someone narrows it", async () => {
    expect((await me(root)).platforms).toEqual(ALL);
    expect((await me(user.session)).platforms).toEqual(ALL);
    // Stored as "missing", so platforms added later are on too
    expect(await stored(user.id)).toBeUndefined();
  });

  it("refuses runs on a platform that's turned off, and hides it", async () => {
    const { status, data } = await setPlatforms(root, user.id, ["elevenlabs"]);
    expect(status).toBe(200);
    expect((data.user as { platforms: string[] }).platforms).toEqual(["elevenlabs"]);
    expect((await me(user.session)).platforms).toEqual(["elevenlabs"]);

    const replicate = await startReplicate(user.session);
    expect(replicate.status).toBe(403);
    expect(replicate.data.code).toBe("PLATFORM_NOT_ALLOWED");
    expect((await api("/api/higgsfield/upload", { session: user.session })).status).toBe(403);
    expect((await api("/api/catalogue/products", { session: user.session })).status).toBe(403);
    expect((await api("/api/catalogue/library", { session: user.session })).status).toBe(403);
    // Allowed: gets past the platform check
    expect((await startElevenLabs(user.session)).status).not.toBe(403);

    // Lands on its own platform, not Replicate
    const home = await api("/", { session: user.session });
    expect(home.headers.get("location")).toMatch(/\/elevenlabs$/);
    // Spend and history stay readable
    expect((await api("/api/expenses/entries", { session: user.session })).status).toBe(200);
  });

  it("can take every platform away, and give them all back", async () => {
    expect((await setPlatforms(root, user.id, [])).status).toBe(200);
    expect((await me(user.session)).platforms).toEqual([]);
    expect((await startElevenLabs(user.session)).status).toBe(403);
    expect((await api("/", { session: user.session })).headers.get("location")).toMatch(/\/history$/);

    expect((await setPlatforms(root, user.id, ALL)).status).toBe(200);
    expect(await stored(user.id)).toBeUndefined();
    expect((await startReplicate(user.session)).status).not.toBe(403);
  });

  it("checks the request", async () => {
    expect((await setPlatforms(root, user.id, ["replicate", "nope"])).status).toBe(400);
    expect((await setPlatforms(root, user.id, "replicate")).status).toBe(400);
    // Not your own, and the super admin always has all
    expect((await setPlatforms(admin.session, admin.id, ["replicate"])).status).toBe(400);
    // Users can't edit accounts at all
    expect((await setPlatforms(user.session, user.id, ["replicate"])).status).toBe(403);
    expect((await setPlatforms(user.session, admin.id, ["replicate"])).status).toBe(403);
  });

  it("lets an admin hand out only the platforms they have", async () => {
    expect((await setPlatforms(root, admin.id, ["replicate", "catalogue"])).status).toBe(200);

    // New accounts start with what their creator has
    const created = await api("/api/users", {
      session: admin.session,
      json: { username: `plat${Date.now()}`, name: "P", password: "Pass-123456789", role: "user" },
    });
    expect(created.status).toBe(201);
    expect((created.data.user as { platforms: string[] }).platforms).toEqual(["replicate", "catalogue"]);

    const granting = await api("/api/users", {
      session: admin.session,
      json: { username: `plat2${Date.now()}`, name: "P", password: "Pass-123456789", role: "user", platforms: ["elevenlabs"] },
    });
    expect(granting.status).toBe(403);

    // The super admin gave this user ElevenLabs; the admin
    // narrowing their own platforms leaves it alone
    expect((await setPlatforms(root, user.id, ["replicate", "elevenlabs"])).status).toBe(200);
    const narrowed = await setPlatforms(admin.session, user.id, ["catalogue"]);
    expect(narrowed.status).toBe(200);
    expect((narrowed.data.user as { platforms: string[] }).platforms).toEqual(["elevenlabs", "catalogue"]);
    expect((await setPlatforms(admin.session, user.id, ["higgsfield"])).status).toBe(403);
  });
});

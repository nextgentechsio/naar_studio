import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, db, loginRoot } from "./helpers";

// --------------------------------------------------
// Notifications: only the super admin sends (and
// deletes); every user receives, with their own read
// state.
// --------------------------------------------------

type Session = Awaited<ReturnType<typeof loginRoot>>;
type Item = { id: string; title: string; body: string; level: string; from: string; read: boolean; to?: string[] | null; recalled?: boolean };

const ALICE = `Alice ${Date.now()}`;
let root: Session;
let admin: Awaited<ReturnType<typeof createUser>>;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  root = await loginRoot();
  admin = await createUser(root, "admin");
  alice = await createUser(root, "user", { name: ALICE });
  bob = await createUser(root, "user");
});

afterAll(closeDb);

async function inbox(session: Session) {
  const { status, data } = await api("/api/notifications", { session });
  expect(status).toBe(200);
  return data as { notifications: Item[]; unread: number };
}

const send = (session: Session, json: Record<string, unknown>) => api("/api/notifications", { session, json });

describe("notifications", () => {
  it("only the super admin can send", async () => {
    expect((await send(alice.session, { title: "Hi" })).status).toBe(403);
    expect((await send(admin.session, { title: "Hi" })).status).toBe(403);
    expect((await api("/api/notifications")).status).toBe(401);
  });

  it("checks what is sent", async () => {
    expect((await send(root, { title: "   " })).status).toBe(400);
    expect((await send(root, { title: "x".repeat(121) })).status).toBe(400);
    expect((await send(root, { title: "Hi", body: "x".repeat(2001) })).status).toBe(400);
    expect((await send(root, { title: "Hi", level: "urgent" })).status).toBe(400);
  });

  it("reaches every user, unread until each reads it", async () => {
    const title = `Maintenance ${Date.now()}`;
    const { status, data } = await send(root, { title, body: "Back at 6 pm", level: "important" });
    expect(status).toBe(201);
    const id = (data.notification as Item).id;

    for (const user of [alice, bob, admin]) {
      const box = await inbox(user.session);
      expect(box.notifications.find((item) => item.id === id)).toMatchObject({
        title,
        body: "Back at 6 pm",
        level: "important",
        read: false,
      });
      expect(box.unread).toBeGreaterThan(0);
    }

    // The sender has seen it
    expect((await inbox(root)).notifications.find((item) => item.id === id)?.read).toBe(true);

    // Alice reads it; Bob still hasn't
    expect((await api("/api/notifications", { session: alice.session, method: "PATCH", json: { read: [id] } })).status).toBe(204);
    expect((await inbox(alice.session)).notifications.find((item) => item.id === id)?.read).toBe(true);
    expect((await inbox(bob.session)).notifications.find((item) => item.id === id)?.read).toBe(false);

    // "all" clears Bob's
    expect((await api("/api/notifications", { session: bob.session, method: "PATCH", json: { read: "all" } })).status).toBe(204);
    expect((await inbox(bob.session)).unread).toBe(0);

    expect((await api("/api/notifications", { session: bob.session, method: "PATCH", json: { read: 5 } })).status).toBe(400);
  });

  it("only the super admin can delete, and it goes for everyone", async () => {
    const { data } = await send(root, { title: `Typo ${Date.now()}` });
    const id = (data.notification as Item).id;

    expect((await api(`/api/notifications/${id}`, { session: alice.session, method: "DELETE" })).status).toBe(403);
    expect((await api(`/api/notifications/${id}`, { session: root, method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/notifications/${id}`, { session: root, method: "DELETE" })).status).toBe(404);
    expect((await api(`/api/notifications/not-an-id`, { session: root, method: "DELETE" })).status).toBe(404);

    expect((await inbox(alice.session)).notifications.some((item) => item.id === id)).toBe(false);
  });

  it("sends to chosen users only", async () => {
    const title = `Just for Alice ${Date.now()}`;
    const { status, data } = await send(root, { title, to: [alice.id] });
    expect(status).toBe(201);
    const id = (data.notification as Item).id;

    expect((await inbox(alice.session)).notifications.find((item) => item.id === id)).toMatchObject({ read: false });
    // Not for Bob or the admin
    expect((await inbox(bob.session)).notifications.some((item) => item.id === id)).toBe(false);
    expect((await inbox(admin.session)).notifications.some((item) => item.id === id)).toBe(false);
    // Bob can't mark it read either (nothing to mark)
    expect((await api("/api/notifications", { session: bob.session, method: "PATCH", json: { read: [id] } })).status).toBe(204);
    expect(await (await db()).collection("notificationReads").countDocuments({ notificationId: id, userId: bob.id })).toBe(0);

    // The super admin sees who it went to; users aren't told
    expect((await inbox(root)).notifications.find((item) => item.id === id)?.to).toEqual([ALICE]);
    expect((await inbox(alice.session)).notifications.find((item) => item.id === id)?.to).toBeUndefined();

    // Everyone-messages say so to the super admin
    const everyone = await send(root, { title: `All ${Date.now()}`, to: "everyone" });
    expect((await inbox(root)).notifications.find((item) => item.id === (everyone.data.notification as Item).id)?.to).toBeNull();
  });

  it("checks the chosen users", async () => {
    expect((await send(root, { title: "Hi", to: [] })).status).toBe(400);
    expect((await send(root, { title: "Hi", to: "alice" })).status).toBe(400);
    expect((await send(root, { title: "Hi", to: [alice.id, "no-such-user"] })).status).toBe(400);
    expect((await send(root, { title: "Hi", to: Array.from({ length: 201 }, (_, i) => `u${i}`) })).status).toBe(400);
  });

  it("the super admin can recall a message: gone for recipients, kept (marked) for them", async () => {
    const { data } = await send(root, { title: `Wrong link ${Date.now()}` });
    const id = (data.notification as Item).id;
    const recall = (session: Session, json: unknown = { recall: true }) =>
      api(`/api/notifications/${id}`, { session, method: "PATCH", json });

    expect((await inbox(alice.session)).notifications.some((item) => item.id === id)).toBe(true);
    expect((await recall(alice.session)).status).toBe(403);
    expect((await recall(admin.session)).status).toBe(403);
    expect((await recall(root, { recall: "yes" })).status).toBe(400);

    expect((await recall(root)).status).toBe(204);
    // Again: no change, no error
    expect((await recall(root)).status).toBe(204);

    for (const user of [alice, bob, admin]) {
      expect((await inbox(user.session)).notifications.some((item) => item.id === id)).toBe(false);
    }
    // Not even markable by them
    await api("/api/notifications", { session: bob.session, method: "PATCH", json: { read: [id] } });
    expect(await (await db()).collection("notificationReads").countDocuments({ notificationId: id, userId: bob.id })).toBe(0);

    expect((await inbox(root)).notifications.find((item) => item.id === id)).toMatchObject({ recalled: true, to: null });
    // Users are never told about recalls
    expect((await inbox(alice.session)).notifications.every((item) => item.recalled === undefined)).toBe(true);

    expect((await api(`/api/notifications/aaaaaaaaaaaaaaaaaaaaaaaa`, { session: root, method: "PATCH", json: { recall: true } })).status).toBe(404);

    // A recalled message can still be deleted for good
    expect((await api(`/api/notifications/${id}`, { session: root, method: "DELETE" })).status).toBe(204);
    expect((await inbox(root)).notifications.some((item) => item.id === id)).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, loginRoot } from "./helpers";

// --------------------------------------------------
// Messenger: one-to-one chats between active users,
// private to their two members, with read state.
// --------------------------------------------------

type Session = Awaited<ReturnType<typeof loginRoot>>;
type User = Awaited<ReturnType<typeof createUser>>;
type Conversation = {
  id: string;
  other: { id: string; name: string; disabled: boolean };
  last: { body: string; mine: boolean } | null;
  unread: number;
  otherReadAt: string | null;
};
type Message = { id: string; body: string; mine: boolean; senderId: string };

let root: Session;
let alice: User;
let bob: User;
let carol: User;

beforeAll(async () => {
  root = await loginRoot();
  alice = await createUser(root, "user", { name: `Alice ${Date.now()}` });
  bob = await createUser(root, "user", { name: `Bob ${Date.now()}` });
  carol = await createUser(root, "admin", { name: `Carol ${Date.now()}` });
});

afterAll(closeDb);

async function open(from: User, to: string) {
  const { status, data } = await api("/api/messenger/conversations", { session: from.session, json: { userId: to } });
  expect(status).toBe(200);
  return data.conversation as Conversation;
}

const send = (from: User, id: string, body: unknown) =>
  api(`/api/messenger/conversations/${id}/messages`, { session: from.session, json: { body } });

async function page(user: User, id: string, query = "") {
  const { status, data } = await api(`/api/messenger/conversations/${id}/messages${query}`, { session: user.session });
  expect(status).toBe(200);
  return data as { messages: Message[]; hasMore: boolean; otherReadAt: string | null };
}

async function chats(user: User) {
  const { status, data } = await api("/api/messenger/conversations", { session: user.session });
  expect(status).toBe(200);
  return data as { conversations: Conversation[]; unread: number };
}

describe("messenger", () => {
  it("lists people to message: active accounts, not yourself", async () => {
    const { status, data } = await api("/api/messenger/people", { session: alice.session });
    expect(status).toBe(200);
    const ids = (data.people as { id: string }[]).map((person) => person.id);
    expect(ids).toEqual(expect.arrayContaining([bob.id, carol.id]));
    expect(ids).not.toContain(alice.id);
    expect((await api("/api/messenger/people")).status).toBe(401);
  });

  it("one chat per pair, from either side; not with yourself or nobody", async () => {
    const first = await open(alice, bob.id);
    expect((await open(bob, alice.id)).id).toBe(first.id);
    expect(first.other).toMatchObject({ id: bob.id, disabled: false });

    expect((await api("/api/messenger/conversations", { session: alice.session, json: { userId: alice.id } })).status).toBe(400);
    expect((await api("/api/messenger/conversations", { session: alice.session, json: { userId: "nobody" } })).status).toBe(404);
    expect((await api("/api/messenger/conversations", { session: alice.session, json: {} })).status).toBe(400);

    // Empty chats aren't listed until someone writes
    expect((await chats(alice)).conversations.some((chat) => chat.id === first.id)).toBe(false);
  });

  it("sends, counts unread, and reads", async () => {
    const chat = await open(alice, bob.id);
    expect((await send(alice, chat.id, "  ")).status).toBe(400);
    expect((await send(alice, chat.id, "x".repeat(2001))).status).toBe(400);
    expect((await send(alice, chat.id, "Hi Bob")).status).toBe(201);
    expect((await send(alice, chat.id, "Free at 4?")).status).toBe(201);

    const bobs = await chats(bob);
    expect(bobs.conversations.find((item) => item.id === chat.id)).toMatchObject({
      other: { id: alice.id },
      last: { body: "Free at 4?", mine: false },
      unread: 2,
    });
    expect(bobs.unread).toBeGreaterThanOrEqual(2);
    // Your own messages are never unread to you
    expect((await chats(alice)).conversations.find((item) => item.id === chat.id)?.unread).toBe(0);

    const seen = await page(bob, chat.id);
    expect(seen.messages.map((message) => [message.body, message.mine])).toEqual([
      ["Hi Bob", false],
      ["Free at 4?", false],
    ]);

    expect((await api(`/api/messenger/conversations/${chat.id}/read`, { session: bob.session, method: "POST" })).status).toBe(204);
    expect((await chats(bob)).conversations.find((item) => item.id === chat.id)?.unread).toBe(0);
    // Alice can now show "Seen"
    expect((await page(alice, chat.id)).otherReadAt).not.toBeNull();

    // New since the last one Alice has
    expect((await send(bob, chat.id, "Yes!")).status).toBe(201);
    const latest = seen.messages[seen.messages.length - 1].id;
    expect((await page(alice, chat.id, `?after=${latest}`)).messages.map((message) => message.body)).toEqual(["Yes!"]);
  });

  it("keeps chats private to their two members", async () => {
    const chat = await open(alice, bob.id);
    expect((await api(`/api/messenger/conversations/${chat.id}/messages`, { session: carol.session })).status).toBe(404);
    expect((await send(carol, chat.id, "Hello?")).status).toBe(404);
    expect((await api(`/api/messenger/conversations/${chat.id}/read`, { session: carol.session, method: "POST" })).status).toBe(404);
    expect((await chats(carol)).conversations.some((item) => item.id === chat.id)).toBe(false);
    expect((await api(`/api/messenger/conversations/not-an-id/messages`, { session: alice.session })).status).toBe(404);
  });

  it("pages back through older messages", async () => {
    const chat = await open(carol, alice.id);
    for (let i = 1; i <= 45; i++) expect((await send(carol, chat.id, `m${i}`)).status).toBe(201);

    const latest = await page(alice, chat.id);
    expect(latest.messages).toHaveLength(40);
    expect(latest.hasMore).toBe(true);
    expect(latest.messages[0].body).toBe("m6");
    expect(latest.messages[39].body).toBe("m45");

    const older = await page(alice, chat.id, `?before=${latest.messages[0].id}`);
    expect(older.messages.map((message) => message.body)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(older.hasMore).toBe(false);
  });

  it("can't message a disabled account", async () => {
    const dave = await createUser(root, "user", { name: `Dave ${Date.now()}` });
    const chat = await open(alice, dave.id);
    expect((await send(alice, chat.id, "Before")).status).toBe(201);

    expect((await api(`/api/users/${dave.id}`, { session: root, method: "PATCH", json: { disabled: true } })).status).toBe(200);
    expect((await send(alice, chat.id, "After")).status).toBe(400);
    expect((await chats(alice)).conversations.find((item) => item.id === chat.id)?.other.disabled).toBe(true);
    const people = (await api("/api/messenger/people", { session: alice.session })).data.people as { id: string }[];
    expect(people.some((person) => person.id === dave.id)).toBe(false);
  });

  it("the super admin sees every chat, read only, without touching read state", async () => {
    const chat = await open(alice, bob.id);
    expect((await send(bob, chat.id, `Audit check ${Date.now()}`)).status).toBe(201);
    const aliceBefore = (await chats(alice)).conversations.find((item) => item.id === chat.id)!;
    const bobSeenBefore = (await page(bob, chat.id)).otherReadAt;

    // Only the super admin gets the full list
    expect((await api("/api/messenger/conversations?scope=all", { session: alice.session })).status).toBe(403);
    expect((await api("/api/messenger/conversations?scope=all", { session: carol.session })).status).toBe(403);
    const { status, data } = await api("/api/messenger/conversations?scope=all", { session: root });
    expect(status).toBe(200);
    const listed = (data.conversations as { id: string; members: { id: string }[] }[]).find((item) => item.id === chat.id);
    expect(listed?.members.map((member) => member.id).sort()).toEqual([alice.id, bob.id].sort());

    // Reads it: everything, as nobody's "mine", no "Seen"
    const read = await api(`/api/messenger/conversations/${chat.id}/messages`, { session: root });
    expect(read.status).toBe(200);
    const messages = read.data.messages as Message[];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => !message.mine)).toBe(true);
    expect(read.data.otherReadAt).toBeNull();

    // Can't write in it or mark it read
    expect((await api(`/api/messenger/conversations/${chat.id}/messages`, { session: root, json: { body: "Hi" } })).status).toBe(404);
    expect((await api(`/api/messenger/conversations/${chat.id}/read`, { session: root, method: "POST" })).status).toBe(404);

    // The two people's state is untouched
    expect((await chats(alice)).conversations.find((item) => item.id === chat.id)?.unread).toBe(aliceBefore.unread);
    expect((await page(bob, chat.id)).otherReadAt).toBe(bobSeenBefore);
  });
});

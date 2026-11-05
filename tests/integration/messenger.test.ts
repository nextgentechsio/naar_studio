import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, closeDb, createUser, db, loginRoot } from "./helpers";

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

  describe("groups", () => {
    type Group = Conversation & { group: { name: string; members: { id: string }[]; canManage: boolean } };
    const create = (session: Session, json: unknown) => api("/api/messenger/groups", { session, json });
    const patch = (session: Session, id: string, json: unknown) => api(`/api/messenger/groups/${id}`, { session, method: "PATCH", json });
    const memberIds = (group: Group) => group.group.members.map((member) => member.id).sort();

    it("only admins and the super admin create groups", async () => {
      expect((await create(alice.session, { name: "Nope", members: [bob.id] })).status).toBe(403);
      expect((await create(carol.session, { name: "  ", members: [bob.id] })).status).toBe(400);
      expect((await create(carol.session, { name: "Solo", members: [] })).status).toBe(400);
      expect((await create(carol.session, { name: "Ghosts", members: ["nobody"] })).status).toBe(400);
      expect((await create(carol.session, { name: "x".repeat(61), members: [bob.id] })).status).toBe(400);

      const { status, data } = await create(carol.session, { name: "Landmark crew", members: [alice.id, bob.id] });
      expect(status).toBe(201);
      const group = data.conversation as Group;
      expect(group.group).toMatchObject({ name: "Landmark crew", canManage: true });
      expect(memberIds(group)).toEqual([alice.id, bob.id, carol.id].sort());

      // Everyone in it sees it, with the event line as the latest
      for (const user of [alice, bob]) {
        const listed = (await chats(user)).conversations.find((item) => item.id === group.id) as Group | undefined;
        expect(listed?.group.canManage).toBe(false);
        expect(listed?.last?.body).toContain("created the group");
      }
    });

    it("members chat; each message shows who wrote it; 'Seen by' lists readers", async () => {
      const group = (await create(carol.session, { name: `Chat ${Date.now()}`, members: [alice.id, bob.id] })).data.conversation as Group;
      expect((await send(alice, group.id, "Morning all")).status).toBe(201);
      expect((await send(bob, group.id, "Hi!")).status).toBe(201);

      const seen = await page(carol, group.id);
      expect(seen.messages.map((message) => [message.body.slice(0, 12), (message as unknown as { senderName: string; system: boolean }).system])).toEqual([
        [expect.any(String), true],
        ["Morning all", false],
        ["Hi!", false],
      ]);
      expect((seen.messages[1] as unknown as { senderName: string }).senderName).toMatch(/^Alice /);
      expect((await chats(carol)).conversations.find((item) => item.id === group.id)?.unread).toBe(2);

      await api(`/api/messenger/conversations/${group.id}/read`, { session: carol.session, method: "POST" });
      const readers = (await api(`/api/messenger/conversations/${group.id}/messages`, { session: alice.session })).data.readers as { id: string }[];
      expect(readers.map((reader) => reader.id).sort()).toEqual([bob.id, carol.id].sort());
    });

    it("admins manage groups they're in; the super admin manages any group", async () => {
      const group = (await create(carol.session, { name: "Ops", members: [alice.id] })).data.conversation as Group;

      // A plain member can't manage; an outsider can't even see it
      expect((await patch(alice.session, group.id, { name: "Mine now" })).status).toBe(403);
      expect((await patch(bob.session, group.id, { add: [bob.id] })).status).toBe(404);
      expect((await api(`/api/messenger/groups/${group.id}`, { session: bob.session, method: "DELETE" })).status).toBe(404);

      // The admin in it renames, adds and removes; each is posted
      let updated = (await patch(carol.session, group.id, { name: "Ops team", add: [bob.id] })).data.conversation as Group;
      expect(updated.group.name).toBe("Ops team");
      expect(memberIds(updated)).toEqual([alice.id, bob.id, carol.id].sort());
      updated = (await patch(carol.session, group.id, { remove: [alice.id] })).data.conversation as Group;
      expect(memberIds(updated)).toEqual([bob.id, carol.id].sort());
      expect((await patch(carol.session, group.id, { remove: [carol.id] })).status).toBe(400);
      const lines = (await page(bob, group.id)).messages.filter((message) => (message as unknown as { system: boolean }).system).map((message) => message.body);
      expect(lines.join(" | ")).toMatch(/renamed the group to “Ops team” \| .* added .* \| .* removed /);

      // Alice is out: no list entry, no messages, can't write
      expect((await chats(alice)).conversations.some((item) => item.id === group.id)).toBe(false);
      expect((await api(`/api/messenger/conversations/${group.id}/messages`, { session: alice.session })).status).toBe(404);
      expect((await send(alice, group.id, "hello?")).status).toBe(404);

      // The super admin, not a member, manages it too
      const another = await createUser(root, "admin");
      expect((await patch(another.session, group.id, { name: "Hijack" })).status).toBe(404);
      updated = (await patch(root, group.id, { name: "Ops (super)", add: [alice.id] })).data.conversation as Group;
      expect(updated.group).toMatchObject({ name: "Ops (super)", canManage: true });
      expect((await api(`/api/messenger/groups/${group.id}`, { session: root })).status).toBe(200);
      // …but doesn't write in it
      expect((await api(`/api/messenger/conversations/${group.id}/messages`, { session: root, json: { body: "hi" } })).status).toBe(404);
      // All chats lists it by name
      const all = (await api("/api/messenger/conversations?scope=all", { session: root })).data.conversations as { id: string; name: string | null }[];
      expect(all.find((item) => item.id === group.id)?.name).toBe("Ops (super)");

      expect((await api(`/api/messenger/groups/${group.id}`, { session: root, method: "DELETE" })).status).toBe(204);
      expect((await chats(bob)).conversations.some((item) => item.id === group.id)).toBe(false);
    });

    it("anyone can leave; the last one out deletes the group", async () => {
      const group = (await create(carol.session, { name: `Leavers ${Date.now()}`, members: [alice.id] })).data.conversation as Group;
      expect((await api(`/api/messenger/groups/${group.id}/leave`, { session: alice.session, method: "POST" })).status).toBe(204);
      expect((await chats(alice)).conversations.some((item) => item.id === group.id)).toBe(false);
      expect((await page(carol, group.id)).messages.at(-1)?.body).toMatch(/left$/);
      expect((await api(`/api/messenger/groups/${group.id}/leave`, { session: alice.session, method: "POST" })).status).toBe(404);

      expect((await api(`/api/messenger/groups/${group.id}/leave`, { session: carol.session, method: "POST" })).status).toBe(204);
      expect((await api(`/api/messenger/groups/${group.id}`, { session: root })).status).toBe(404);
      // Direct chats can't be "left"
      const direct = await open(alice, bob.id);
      expect((await api(`/api/messenger/groups/${direct.id}/leave`, { session: alice.session, method: "POST" })).status).toBe(400);
    });

    it("won't add disabled accounts", async () => {
      const dan = await createUser(root, "user");
      expect((await api(`/api/users/${dan.id}`, { session: root, method: "PATCH", json: { disabled: true } })).status).toBe(200);
      expect((await create(carol.session, { name: "With Dan", members: [dan.id] })).status).toBe(400);
    });
  });

  describe("super admin deleting", () => {
    const removeMessage = (session: Session, chatId: string, messageId: string) =>
      api(`/api/messenger/conversations/${chatId}/messages/${messageId}`, { session, method: "DELETE" });
    const removeChat = (session: Session, chatId: string) => api(`/api/messenger/conversations/${chatId}`, { session, method: "DELETE" });

    it("deletes any single message, for everyone, and the preview follows", async () => {
      const chat = await open(alice, bob.id);
      const first = (await send(alice, chat.id, `keep ${Date.now()}`)).data.message as Message;
      const second = (await send(bob, chat.id, "delete me")).data.message as Message;

      // Nobody else may: not the people in it, not admins
      for (const session of [alice.session, bob.session, carol.session]) {
        expect((await removeMessage(session, chat.id, second.id)).status).toBe(403);
      }

      expect((await removeMessage(root, chat.id, second.id)).status).toBe(204);
      expect((await removeMessage(root, chat.id, second.id)).status).toBe(404);
      expect((await removeMessage(root, chat.id, "not-an-id")).status).toBe(404);

      const seen = await page(alice, chat.id);
      expect(seen.messages.some((message) => message.id === second.id)).toBe(false);
      // Open windows learn which to drop
      expect((seen as unknown as { deleted: string[] }).deleted).toContain(second.id);
      expect((await chats(alice)).conversations.find((item) => item.id === chat.id)?.last?.body).toBe(first.body);
    });

    it("deletes whole chats, direct and group, for everyone in them", async () => {
      const direct = await open(bob, carol.id);
      await send(bob, direct.id, "something");
      const group = (await api("/api/messenger/groups", { session: carol.session, json: { name: `Doomed ${Date.now()}`, members: [alice.id] } })).data
        .conversation as Conversation;

      expect((await removeChat(carol.session, group.id)).status).toBe(403);
      expect((await removeChat(bob.session, direct.id)).status).toBe(403);

      expect((await removeChat(root, direct.id)).status).toBe(204);
      expect((await removeChat(root, group.id)).status).toBe(204);
      expect((await removeChat(root, group.id)).status).toBe(404);

      expect((await chats(bob)).conversations.some((item) => item.id === direct.id)).toBe(false);
      expect((await chats(alice)).conversations.some((item) => item.id === group.id)).toBe(false);
      expect((await api(`/api/messenger/conversations/${direct.id}/messages`, { session: bob.session })).status).toBe(404);
      expect(await (await db()).collection("messages").countDocuments({ conversationId: new ObjectId(direct.id) })).toBe(0);
    });

    it("a group keeps its place when all its messages are deleted", async () => {
      const group = (await api("/api/messenger/groups", { session: carol.session, json: { name: `Empty ${Date.now()}`, members: [alice.id] } })).data
        .conversation as Conversation;
      for (const message of (await page(carol, group.id)).messages) {
        expect((await removeMessage(root, group.id, message.id)).status).toBe(204);
      }
      const listed = (await chats(alice)).conversations.find((item) => item.id === group.id);
      expect(listed).toBeDefined();
      expect(listed?.last).toBeNull();
    });
  });
});

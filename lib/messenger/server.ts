import { ObjectId, type Collection } from "mongodb";
import { getDb, usersCollection } from "@/lib/db/mongodb";
import { canDeleteAnyChat, canManageGroups, canReadAllChats } from "@/lib/auth/roles";
import type { StoredUser } from "@/lib/auth/users";
import {
  CONVERSATION_LIMIT,
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX,
  MESSAGE_MAX,
  PAGE_SIZE,
  type AuditList,
  type ConversationList,
  type Member,
  type MessagePage,
  type Person,
  type PublicConversation,
  type PublicMessage,
} from "@/lib/messenger/shared";

// --------------------------------------------------
// MESSENGER (MongoDB "conversations", "messages")
//
// Direct chats: one per pair of active users, keyed by
// the two members. Groups: a name and members, made and
// managed by admins (groups they're in) and the super
// admin (every group); anyone can leave a group. Group
// changes are posted in it as event lines.
// Read state is when each member last read it; unread =
// others' messages after that. The super admin can read
// every chat (never write in or mark read others') and
// delete any message or chat.
// Own collections and indexes, set up here.
// --------------------------------------------------

type ConversationDoc = {
  _id: ObjectId;
  // Direct: the two member ids, sorted, joined (one per
  // pair). Group: "group:<id>"
  key: string;
  members: string[];
  createdAt: Date;
  lastMessageAt: Date | null;
  lastMessage: { body: string; senderId: string } | null;
  // userId → when they last read it
  readAt: Record<string, Date>;
  // Recently deleted message ids (the super admin's),
  // so open windows drop them
  deletedMessageIds?: string[];
  // Groups only
  kind?: "group";
  name?: string;
  createdBy?: string;
};

type MessageDoc = {
  _id: ObjectId;
  conversationId: ObjectId;
  senderId: string;
  body: string;
  createdAt: Date;
  // A group event, written by its actor
  system?: boolean;
};

export class MessengerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const globalForMessenger = globalThis as unknown as { messengerIndexes?: Promise<unknown> };

async function collections(): Promise<{
  conversations: Collection<ConversationDoc>;
  messages: Collection<MessageDoc>;
}> {
  const db = await getDb();
  const conversations = db.collection<ConversationDoc>("conversations");
  const messages = db.collection<MessageDoc>("messages");

  if (!globalForMessenger.messengerIndexes) {
    globalForMessenger.messengerIndexes = Promise.all([
      conversations.createIndex({ key: 1 }, { unique: true }),
      conversations.createIndex({ members: 1, lastMessageAt: -1 }),
      messages.createIndex({ conversationId: 1, _id: -1 }),
    ]).catch((error) => {
      globalForMessenger.messengerIndexes = undefined;
      throw error;
    });
  }
  await globalForMessenger.messengerIndexes;

  return { conversations, messages };
}

type Viewer = Pick<StoredUser, "id"> & Partial<Pick<StoredUser, "role" | "disabled" | "name">>;

const asActor = (viewer: Viewer) => ({ id: viewer.id, role: viewer.role ?? "user", disabled: Boolean(viewer.disabled) });

// The super admin can read every chat
const canAudit = (viewer: Viewer) => Boolean(viewer.role) && canReadAllChats(asActor(viewer));

const isGroup = (doc: ConversationDoc) => doc.kind === "group";

// Admins manage groups they're in; the super admin, all
function canManage(viewer: Viewer, doc: ConversationDoc) {
  if (!isGroup(doc) || !viewer.role || !canManageGroups(asActor(viewer))) return false;
  return viewer.role === "super_admin" || doc.members.includes(viewer.id);
}

const otherOf = (doc: ConversationDoc, viewer: Viewer) => doc.members.find((id) => id !== viewer.id) ?? viewer.id;

type UserRow = { _id: string; name: string; username: string; disabled?: boolean };

// Current names (renames show at once), by id
async function peopleById(ids: string[]): Promise<Map<string, UserRow>> {
  if (!ids.length) return new Map();
  const users = await (await usersCollection())
    .find({ _id: { $in: [...new Set(ids)] } }, { projection: { _id: 1, name: 1, username: 1, disabled: 1 } })
    .toArray();
  return new Map(users.map((user) => [user._id, user]));
}

const toMember = (id: string, row: UserRow | undefined): Member => ({
  id,
  name: row?.name ?? "Deleted user",
  username: row?.username ?? "",
  disabled: !row || Boolean(row.disabled),
});

function toPublicMessage(doc: MessageDoc, viewer: Viewer, people: Map<string, UserRow>): PublicMessage {
  return {
    id: doc._id.toHexString(),
    body: doc.body,
    senderId: doc.senderId,
    senderName: people.get(doc.senderId)?.name ?? "Deleted user",
    mine: doc.senderId === viewer.id,
    system: Boolean(doc.system),
    createdAt: doc.createdAt.toISOString(),
  };
}

// Everyone the viewer can start a chat with (or add to a
// group): active accounts, not themselves
export async function listPeople(viewer: Viewer): Promise<Person[]> {
  const users = await (await usersCollection())
    .find({ disabled: { $ne: true }, _id: { $ne: viewer.id } }, { projection: { _id: 1, name: 1, username: 1 } })
    .sort({ name: 1 })
    .toArray();
  return users.map((user) => ({ id: user._id, name: user.name, username: user.username }));
}

async function toPublicConversations(docs: ConversationDoc[], viewer: Viewer): Promise<PublicConversation[]> {
  const { messages } = await collections();
  const people = await peopleById(
    docs.flatMap((doc) => [...(isGroup(doc) ? doc.members : [otherOf(doc, viewer)]), ...(doc.lastMessage ? [doc.lastMessage.senderId] : [])]),
  );

  return Promise.all(
    docs.map(async (doc) => {
      const readAt = doc.readAt?.[viewer.id];
      // Only counted when the latest is someone else's and
      // newer than the viewer's read time (usually 0)
      const maybeUnread =
        doc.members.includes(viewer.id) &&
        doc.lastMessage &&
        doc.lastMessage.senderId !== viewer.id &&
        doc.lastMessageAt &&
        (!readAt || doc.lastMessageAt > readAt);
      const unread = maybeUnread
        ? await messages.countDocuments({
            conversationId: doc._id,
            senderId: { $ne: viewer.id },
            ...(readAt ? { createdAt: { $gt: readAt } } : {}),
          })
        : 0;

      const id = doc._id.toHexString();
      const last = doc.lastMessage
        ? {
            body: doc.lastMessage.body,
            mine: doc.lastMessage.senderId === viewer.id,
            at: doc.lastMessageAt!.toISOString(),
            sender: people.get(doc.lastMessage.senderId)?.name ?? "",
          }
        : null;

      if (isGroup(doc)) {
        return {
          id,
          other: { id, name: doc.name ?? "Group", username: "", disabled: false },
          group: {
            name: doc.name ?? "Group",
            members: doc.members.map((memberId) => toMember(memberId, people.get(memberId))),
            createdBy: doc.createdBy ?? "",
            canManage: canManage(viewer, doc),
          },
          last,
          unread,
          otherReadAt: null,
        };
      }

      const otherId = otherOf(doc, viewer);
      return {
        id,
        other: toMember(otherId, people.get(otherId)),
        group: null,
        last,
        unread,
        otherReadAt: doc.readAt?.[otherId]?.toISOString() ?? null,
      };
    }),
  );
}

// The viewer's chats with messages, latest first
export async function listConversations(viewer: Viewer): Promise<ConversationList> {
  const { conversations } = await collections();
  const docs = await conversations
    .find({ members: viewer.id, lastMessageAt: { $ne: null } })
    .sort({ lastMessageAt: -1 })
    .limit(CONVERSATION_LIMIT)
    .toArray();

  const list = await toPublicConversations(docs, viewer);
  return { conversations: list, unread: list.reduce((total, item) => total + item.unread, 0) };
}

// The direct chat with this person, made if it's the first
export async function openConversation(viewer: Viewer, otherId: unknown): Promise<PublicConversation> {
  if (typeof otherId !== "string" || !otherId) throw new MessengerError(400, "Choose who to message");
  if (otherId === viewer.id) throw new MessengerError(400, "You can't message yourself");

  const other = (await peopleById([otherId])).get(otherId);
  if (!other) throw new MessengerError(404, "That person doesn't exist");

  const members = [viewer.id, otherId].sort();
  const key = members.join(":");
  const { conversations } = await collections();
  const doc = await conversations.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        key,
        members,
        createdAt: new Date(),
        lastMessageAt: null,
        lastMessage: null,
        readAt: {},
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const [conversation] = await toPublicConversations([doc!], viewer);
  return conversation;
}

// The conversation, if the viewer is in it (or, to read
// only, if they're the super admin)
async function memberOf(viewer: Viewer, id: string, options: { audit?: boolean } = {}): Promise<ConversationDoc> {
  if (!ObjectId.isValid(id)) throw new MessengerError(404, "Conversation not found");
  const { conversations } = await collections();
  const audit = options.audit && canAudit(viewer);
  const doc = await conversations.findOne({ _id: new ObjectId(id), ...(audit ? {} : { members: viewer.id }) });
  if (!doc) throw new MessengerError(404, "Conversation not found");
  return doc;
}

// Super admin: every chat with messages, latest first
export async function listAllConversations(viewer: Viewer): Promise<AuditList> {
  if (!canAudit(viewer)) throw new MessengerError(403, "Only the super admin can see all chats");
  const { conversations } = await collections();
  const docs = await conversations
    .find({ lastMessageAt: { $ne: null } })
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .toArray();

  const people = await peopleById(docs.flatMap((doc) => doc.members));
  return {
    conversations: docs.map((doc) => ({
      id: doc._id.toHexString(),
      name: isGroup(doc) ? (doc.name ?? "Group") : null,
      members: doc.members.map((memberId) => toMember(memberId, people.get(memberId))),
      last: doc.lastMessage
        ? { body: doc.lastMessage.body, senderId: doc.lastMessage.senderId, at: doc.lastMessageAt!.toISOString() }
        : null,
    })),
  };
}

// The super admin managing a group they aren't in (from
// All chats): its details as a conversation
export async function getGroup(viewer: Viewer, id: string): Promise<PublicConversation> {
  const doc = await manageable(viewer, id);
  const [conversation] = await toPublicConversations([doc], viewer);
  return conversation;
}

const validCursor = (value: string | null) => (value && ObjectId.isValid(value) ? new ObjectId(value) : null);

// A page of messages, oldest first: the latest ones; or
// before a message (scrolling back); or after one (new
// since the last check)
export async function listMessages(
  viewer: Viewer,
  id: string,
  options: { before?: string | null; after?: string | null } = {},
): Promise<MessagePage> {
  const conversation = await memberOf(viewer, id, { audit: true });
  const isMember = conversation.members.includes(viewer.id);
  const { messages } = await collections();
  const after = validCursor(options.after ?? null);
  const before = validCursor(options.before ?? null);

  let docs: MessageDoc[];
  let hasMore = false;
  if (after) {
    docs = await messages.find({ conversationId: conversation._id, _id: { $gt: after } }).sort({ _id: 1 }).limit(200).toArray();
  } else {
    const newestFirst = await messages
      .find({ conversationId: conversation._id, ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    hasMore = newestFirst.length > PAGE_SIZE;
    docs = newestFirst.slice(0, PAGE_SIZE).reverse();
  }

  const people = await peopleById([...docs.map((doc) => doc.senderId), ...conversation.members]);
  const otherId = otherOf(conversation, viewer);
  return {
    messages: docs.map((doc) => toPublicMessage(doc, viewer, people)),
    hasMore,
    // "Seen" is for the people in it only
    otherReadAt: isMember && !isGroup(conversation) ? (conversation.readAt?.[otherId]?.toISOString() ?? null) : null,
    readers:
      isMember && isGroup(conversation)
        ? conversation.members
            .filter((memberId) => memberId !== viewer.id && conversation.readAt?.[memberId])
            .map((memberId) => ({
              id: memberId,
              name: people.get(memberId)?.name ?? "Deleted user",
              readAt: conversation.readAt[memberId].toISOString(),
            }))
        : [],
    deleted: conversation.deletedMessageIds ?? [],
  };
}

async function post(conversation: ConversationDoc, sender: string, body: string, system = false): Promise<MessageDoc> {
  const { conversations, messages } = await collections();
  const doc: MessageDoc = {
    _id: new ObjectId(),
    conversationId: conversation._id,
    senderId: sender,
    body,
    createdAt: new Date(),
    ...(system ? { system: true } : {}),
  };
  await messages.insertOne(doc);
  await conversations.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageAt: doc.createdAt,
        lastMessage: { body: body.slice(0, 200), senderId: sender },
        // Writing means they've read everything before it
        ...(conversation.members.includes(sender) ? { [`readAt.${sender}`]: doc.createdAt } : {}),
      },
    },
  );
  return doc;
}

export async function sendMessage(viewer: Viewer, id: string, input: unknown): Promise<PublicMessage> {
  const raw = (input as { body?: unknown } | null)?.body;
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new MessengerError(400, "Write a message");
  if (body.length > MESSAGE_MAX) throw new MessengerError(400, `Keep messages under ${MESSAGE_MAX} characters`);

  const conversation = await memberOf(viewer, id);
  if (!isGroup(conversation)) {
    const otherId = otherOf(conversation, viewer);
    const other = (await peopleById([otherId])).get(otherId);
    if (!other || other.disabled) throw new MessengerError(400, "This account is disabled, so it can't get messages");
  }

  const doc = await post(conversation, viewer.id, body);
  return toPublicMessage(doc, viewer, await peopleById([viewer.id]));
}

export async function markConversationRead(viewer: Viewer, id: string): Promise<void> {
  const conversation = await memberOf(viewer, id);
  const { conversations } = await collections();
  await conversations.updateOne({ _id: conversation._id }, { $set: { [`readAt.${viewer.id}`]: new Date() } });
}

// --------------------------------------------------
// GROUPS
// --------------------------------------------------

function groupName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new MessengerError(400, "Give the group a name");
  if (name.length > GROUP_NAME_MAX) throw new MessengerError(400, `Keep the name under ${GROUP_NAME_MAX} characters`);
  return name;
}

function idList(raw: unknown, label: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string" && item)) {
    throw new MessengerError(400, `${label} must be a list of people`);
  }
  return [...new Set(raw as string[])];
}

// Active accounts only; names for the event line
async function activePeople(ids: string[]): Promise<UserRow[]> {
  const people = await peopleById(ids);
  return ids.map((id) => {
    const person = people.get(id);
    if (!person) throw new MessengerError(400, "Some of those people don't exist");
    if (person.disabled) throw new MessengerError(400, `${person.name}'s account is disabled`);
    return person;
  });
}

const names = (people: { name: string }[]) =>
  people.length <= 2
    ? people.map((person) => person.name).join(" and ")
    : `${people
        .slice(0, -1)
        .map((person) => person.name)
        .join(", ")} and ${people[people.length - 1].name}`;

async function actorName(viewer: Viewer) {
  return viewer.name ?? (await peopleById([viewer.id])).get(viewer.id)?.name ?? "Someone";
}

// A group the viewer may manage: 404 when they can't see
// it, 403 when they're in it but may not manage it
async function manageable(viewer: Viewer, id: string): Promise<ConversationDoc> {
  if (!ObjectId.isValid(id)) throw new MessengerError(404, "Group not found");
  const { conversations } = await collections();
  const doc = await conversations.findOne({ _id: new ObjectId(id), kind: "group" });
  if (!doc) throw new MessengerError(404, "Group not found");
  if (canManage(viewer, doc)) return doc;
  if (doc.members.includes(viewer.id)) throw new MessengerError(403, "Only admins can manage groups");
  throw new MessengerError(404, "Group not found");
}

export async function createGroup(viewer: Viewer, input: unknown): Promise<PublicConversation> {
  if (!viewer.role || !canManageGroups(asActor(viewer))) throw new MessengerError(403, "Only admins can create groups");
  const body = (input ?? {}) as { name?: unknown; members?: unknown };
  const name = groupName(body.name);
  const others = idList(body.members, "Members").filter((id) => id !== viewer.id);
  if (!others.length) throw new MessengerError(400, "Add at least one person");
  if (others.length + 1 > GROUP_MAX_MEMBERS) throw new MessengerError(400, `A group can have up to ${GROUP_MAX_MEMBERS} people`);
  const added = await activePeople(others);

  const { conversations } = await collections();
  const _id = new ObjectId();
  const doc: ConversationDoc = {
    _id,
    key: `group:${_id.toHexString()}`,
    kind: "group",
    name,
    createdBy: viewer.id,
    members: [viewer.id, ...others],
    createdAt: new Date(),
    lastMessageAt: null,
    lastMessage: null,
    readAt: {},
  };
  await conversations.insertOne(doc);
  await post(doc, viewer.id, `${await actorName(viewer)} created the group with ${names(added)}`, true);

  return getGroup(viewer, _id.toHexString());
}

export async function updateGroup(viewer: Viewer, id: string, input: unknown): Promise<PublicConversation> {
  const doc = await manageable(viewer, id);
  const body = (input ?? {}) as { name?: unknown; add?: unknown; remove?: unknown };
  const actor = await actorName(viewer);
  const { conversations } = await collections();

  if (body.name !== undefined) {
    const name = groupName(body.name);
    if (name !== doc.name) {
      await conversations.updateOne({ _id: doc._id }, { $set: { name } });
      doc.name = name;
      await post(doc, viewer.id, `${actor} renamed the group to “${name}”`, true);
    }
  }

  const add = idList(body.add, "People to add").filter((personId) => !doc.members.includes(personId));
  if (add.length) {
    if (doc.members.length + add.length > GROUP_MAX_MEMBERS) {
      throw new MessengerError(400, `A group can have up to ${GROUP_MAX_MEMBERS} people`);
    }
    const added = await activePeople(add);
    await conversations.updateOne({ _id: doc._id }, { $addToSet: { members: { $each: add } } });
    doc.members.push(...add);
    await post(doc, viewer.id, `${actor} added ${names(added)}`, true);
  }

  const remove = idList(body.remove, "People to remove");
  if (remove.includes(viewer.id)) throw new MessengerError(400, "To leave the group, use Leave");
  const removing = remove.filter((personId) => doc.members.includes(personId));
  if (removing.length) {
    const people = await peopleById(removing);
    await conversations.updateOne(
      { _id: doc._id },
      { $pull: { members: { $in: removing } }, $unset: Object.fromEntries(removing.map((personId) => [`readAt.${personId}`, ""])) },
    );
    doc.members = doc.members.filter((memberId) => !removing.includes(memberId));
    await post(doc, viewer.id, `${actor} removed ${names(removing.map((personId) => ({ name: people.get(personId)?.name ?? "someone" })))}`, true);
  }

  return getGroup(viewer, id);
}

// Anyone in a group can leave it; the last one out
// deletes it
export async function leaveGroup(viewer: Viewer, id: string): Promise<void> {
  const doc = await memberOf(viewer, id);
  if (!isGroup(doc)) throw new MessengerError(400, "Only groups can be left");
  const { conversations, messages } = await collections();

  if (doc.members.length <= 1) {
    await messages.deleteMany({ conversationId: doc._id });
    await conversations.deleteOne({ _id: doc._id });
    return;
  }
  await conversations.updateOne({ _id: doc._id }, { $pull: { members: viewer.id }, $unset: { [`readAt.${viewer.id}`]: "" } });
  doc.members = doc.members.filter((memberId) => memberId !== viewer.id);
  await post(doc, viewer.id, `${await actorName(viewer)} left`, true);
}

export async function deleteGroup(viewer: Viewer, id: string): Promise<void> {
  const doc = await manageable(viewer, id);
  const { conversations, messages } = await collections();
  await messages.deleteMany({ conversationId: doc._id });
  await conversations.deleteOne({ _id: doc._id });
}

// --------------------------------------------------
// DELETING (the super admin)
// --------------------------------------------------

// How many deleted ids a chat remembers for open windows
const DELETED_KEPT = 200;

function deleter(viewer: Viewer) {
  if (!viewer.role || !canDeleteAnyChat(asActor(viewer))) {
    throw new MessengerError(403, "Only the super admin can delete messages and chats");
  }
}

// The list preview follows the newest message left (a
// group with none stays listed, as "No messages yet")
async function refreshLast(doc: ConversationDoc): Promise<void> {
  const { conversations, messages } = await collections();
  const latest = await messages.find({ conversationId: doc._id }).sort({ _id: -1 }).limit(1).next();
  await conversations.updateOne(
    { _id: doc._id },
    {
      $set: latest
        ? { lastMessageAt: latest.createdAt, lastMessage: { body: latest.body.slice(0, 200), senderId: latest.senderId } }
        : { lastMessageAt: isGroup(doc) ? doc.createdAt : null, lastMessage: null },
    },
  );
}

// One message, from any chat, for everyone in it
export async function deleteMessage(viewer: Viewer, id: string, messageId: string): Promise<void> {
  deleter(viewer);
  if (!ObjectId.isValid(messageId)) throw new MessengerError(404, "Message not found");
  const doc = await memberOf(viewer, id, { audit: true });
  const { conversations, messages } = await collections();

  const result = await messages.deleteOne({ _id: new ObjectId(messageId), conversationId: doc._id });
  if (!result.deletedCount) throw new MessengerError(404, "Message not found");

  await conversations.updateOne(
    { _id: doc._id },
    { $push: { deletedMessageIds: { $each: [messageId], $slice: -DELETED_KEPT } } },
  );
  await refreshLast(doc);
}

// A whole chat, direct or group, with its messages
export async function deleteConversation(viewer: Viewer, id: string): Promise<void> {
  deleter(viewer);
  const doc = await memberOf(viewer, id, { audit: true });
  const { conversations, messages } = await collections();
  await messages.deleteMany({ conversationId: doc._id });
  await conversations.deleteOne({ _id: doc._id });
}

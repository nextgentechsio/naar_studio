import { ObjectId, type Collection } from "mongodb";
import { getDb, usersCollection } from "@/lib/db/mongodb";
import { canReadAllChats } from "@/lib/auth/roles";
import type { StoredUser } from "@/lib/auth/users";
import {
  CONVERSATION_LIMIT,
  MESSAGE_MAX,
  PAGE_SIZE,
  type AuditList,
  type ConversationList,
  type MessagePage,
  type Person,
  type PublicConversation,
  type PublicMessage,
} from "@/lib/messenger/shared";

// --------------------------------------------------
// MESSENGER (MongoDB "conversations", "messages")
//
// One-to-one chats between any two active users. A
// conversation is keyed by its two members, so each pair
// has exactly one. Read state is when each member last
// read it; unread = the other's messages after that.
// Own collections and indexes, set up here.
// --------------------------------------------------

type ConversationDoc = {
  _id: ObjectId;
  // The two member ids, sorted, joined: one per pair
  key: string;
  members: string[];
  createdAt: Date;
  lastMessageAt: Date | null;
  lastMessage: { body: string; senderId: string } | null;
  // userId → when they last read it
  readAt: Record<string, Date>;
};

type MessageDoc = {
  _id: ObjectId;
  conversationId: ObjectId;
  senderId: string;
  body: string;
  createdAt: Date;
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

type Viewer = Pick<StoredUser, "id"> & Partial<Pick<StoredUser, "role" | "disabled">>;

// The super admin can read every chat (never write in or
// mark read someone else's)
const canAudit = (viewer: Viewer) =>
  Boolean(viewer.role) && canReadAllChats({ id: viewer.id, role: viewer.role!, disabled: Boolean(viewer.disabled) });

const otherOf = (doc: ConversationDoc, viewer: Viewer) => doc.members.find((id) => id !== viewer.id) ?? viewer.id;

function toPublicMessage(doc: MessageDoc, viewer: Viewer): PublicMessage {
  return {
    id: doc._id.toHexString(),
    body: doc.body,
    senderId: doc.senderId,
    mine: doc.senderId === viewer.id,
    createdAt: doc.createdAt.toISOString(),
  };
}

// Everyone the viewer can start a chat with
export async function listPeople(viewer: Viewer): Promise<Person[]> {
  const users = await (await usersCollection())
    .find({ disabled: { $ne: true }, _id: { $ne: viewer.id } }, { projection: { _id: 1, name: 1, username: 1 } })
    .sort({ name: 1 })
    .toArray();
  return users.map((user) => ({ id: user._id, name: user.name, username: user.username }));
}

// Current names (renames show at once), by id
async function peopleById(ids: string[]) {
  const users = await (await usersCollection())
    .find({ _id: { $in: ids } }, { projection: { _id: 1, name: 1, username: 1, disabled: 1 } })
    .toArray();
  return new Map(users.map((user) => [user._id, user]));
}

async function toPublicConversations(docs: ConversationDoc[], viewer: Viewer): Promise<PublicConversation[]> {
  const { messages } = await collections();
  const people = await peopleById(docs.map((doc) => otherOf(doc, viewer)));

  return Promise.all(
    docs.map(async (doc) => {
      const otherId = otherOf(doc, viewer);
      const person = people.get(otherId);
      const readAt = doc.readAt?.[viewer.id];
      // Only counted when the latest is theirs and newer
      // than the viewer's read time (the common case is 0)
      const maybeUnread =
        doc.lastMessage && doc.lastMessage.senderId !== viewer.id && doc.lastMessageAt && (!readAt || doc.lastMessageAt > readAt);
      const unread = maybeUnread
        ? await messages.countDocuments({
            conversationId: doc._id,
            senderId: { $ne: viewer.id },
            ...(readAt ? { createdAt: { $gt: readAt } } : {}),
          })
        : 0;

      return {
        id: doc._id.toHexString(),
        other: {
          id: otherId,
          name: person?.name ?? "Deleted user",
          username: person?.username ?? "",
          disabled: !person || Boolean(person.disabled),
        },
        last: doc.lastMessage
          ? { body: doc.lastMessage.body, mine: doc.lastMessage.senderId === viewer.id, at: doc.lastMessageAt!.toISOString() }
          : null,
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

// The chat with this person, made if it's the first
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

  const people = await peopleById([...new Set(docs.flatMap((doc) => doc.members))]);
  return {
    conversations: docs.map((doc) => ({
      id: doc._id.toHexString(),
      members: doc.members.map((memberId) => {
        const person = people.get(memberId);
        return {
          id: memberId,
          name: person?.name ?? "Deleted user",
          username: person?.username ?? "",
          disabled: !person || Boolean(person.disabled),
        };
      }),
      last: doc.lastMessage
        ? { body: doc.lastMessage.body, senderId: doc.lastMessage.senderId, at: doc.lastMessageAt!.toISOString() }
        : null,
    })),
  };
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

  const otherId = otherOf(conversation, viewer);
  return {
    messages: docs.map((doc) => toPublicMessage(doc, viewer)),
    hasMore,
    // "Seen" is for the two people only
    otherReadAt: isMember ? (conversation.readAt?.[otherId]?.toISOString() ?? null) : null,
  };
}

export async function sendMessage(viewer: Viewer, id: string, input: unknown): Promise<PublicMessage> {
  const raw = (input as { body?: unknown } | null)?.body;
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new MessengerError(400, "Write a message");
  if (body.length > MESSAGE_MAX) throw new MessengerError(400, `Keep messages under ${MESSAGE_MAX} characters`);

  const conversation = await memberOf(viewer, id);
  const otherId = otherOf(conversation, viewer);
  const other = (await peopleById([otherId])).get(otherId);
  if (!other || other.disabled) throw new MessengerError(400, "This account is disabled, so it can't get messages");

  const { conversations, messages } = await collections();
  const doc: MessageDoc = {
    _id: new ObjectId(),
    conversationId: conversation._id,
    senderId: viewer.id,
    body,
    createdAt: new Date(),
  };
  await messages.insertOne(doc);
  await conversations.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageAt: doc.createdAt,
        lastMessage: { body: body.slice(0, 200), senderId: viewer.id },
        // Sending means they've read everything before it
        [`readAt.${viewer.id}`]: doc.createdAt,
      },
    },
  );

  return toPublicMessage(doc, viewer);
}

export async function markConversationRead(viewer: Viewer, id: string): Promise<void> {
  const conversation = await memberOf(viewer, id);
  const { conversations } = await collections();
  await conversations.updateOne({ _id: conversation._id }, { $set: { [`readAt.${viewer.id}`]: new Date() } });
}

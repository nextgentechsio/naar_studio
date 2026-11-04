import { ObjectId, type Collection } from "mongodb";
import { getDb, usersCollection } from "@/lib/db/mongodb";
import type { StoredUser } from "@/lib/auth/users";
import {
  BODY_MAX,
  MAX_RECIPIENTS,
  NOTIFICATION_LEVELS,
  REPLY_MAX,
  TITLE_MAX,
  type NotificationLevel,
  type PublicNotification,
  type PublicReply,
  type PublicThread,
} from "@/lib/notifications-shared";

export type { PublicNotification } from "@/lib/notifications-shared";

// --------------------------------------------------
// NOTIFICATIONS (MongoDB "notifications",
// "notificationReads")
//
// The super admin sends a message to everyone, or to
// chosen users only (recipients); those users see it in
// the bell (top bar) and as a pop-up the first time. The
// super admin sees every message, to manage them. Who has read what is kept per
// user, one small doc per (message, user).
// Own collections and indexes, set up here.
// --------------------------------------------------

// How many recent messages the bell shows
export const LIST_LIMIT = 30;

type NotificationDoc = {
  _id: ObjectId;
  title: string;
  body: string;
  level: NotificationLevel;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  // User ids; null (or missing) = everyone
  recipients?: string[] | null;
  // Their names when sent, for the super admin's list
  recipientNames?: string[];
  // Recalled: gone for its recipients, kept (marked) for
  // the super admin
  recalledAt?: Date | null;
};

type ReadDoc = {
  // `${notificationId}:${userId}`
  _id: string;
  notificationId: string;
  userId: string;
  readAt: Date;
};

// A reply under a message: in the private thread between
// one recipient (threadUserId) and the super admin
type ReplyDoc = {
  _id: ObjectId;
  notificationId: string;
  threadUserId: string;
  threadUserName: string;
  authorId: string;
  authorName: string;
  fromAdmin: boolean;
  body: string;
  createdAt: Date;
  // Seen by the other side of the thread
  seen: boolean;
};

const globalForNotifications = globalThis as unknown as {
  notificationIndexes?: Promise<unknown>;
};

async function collections(): Promise<{
  notifications: Collection<NotificationDoc>;
  reads: Collection<ReadDoc>;
  replies: Collection<ReplyDoc>;
}> {
  const db = await getDb();
  const notifications = db.collection<NotificationDoc>("notifications");
  const reads = db.collection<ReadDoc>("notificationReads");
  const replies = db.collection<ReplyDoc>("notificationReplies");

  if (!globalForNotifications.notificationIndexes) {
    globalForNotifications.notificationIndexes = Promise.all([
      notifications.createIndex({ createdAt: -1 }),
      notifications.createIndex({ recipients: 1, createdAt: -1 }),
      reads.createIndex({ userId: 1, notificationId: 1 }),
      reads.createIndex({ notificationId: 1 }),
      replies.createIndex({ notificationId: 1, threadUserId: 1, createdAt: 1 }),
    ]).catch((error) => {
      globalForNotifications.notificationIndexes = undefined;
      throw error;
    });
  }
  await globalForNotifications.notificationIndexes;

  return { notifications, reads, replies };
}

export class NotificationInputError extends Error {}

// Trimmed, length-checked input, or a readable error
export function parseNotification(body: unknown): {
  title: string;
  body: string;
  level: NotificationLevel;
  recipients: string[] | null;
} {
  const input = (body ?? {}) as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const text = typeof input.body === "string" ? input.body.trim() : "";
  const level = input.level === undefined ? "info" : input.level;

  if (!title) throw new NotificationInputError("Add a title");
  if (title.length > TITLE_MAX) throw new NotificationInputError(`Keep the title under ${TITLE_MAX} characters`);
  if (text.length > BODY_MAX) throw new NotificationInputError(`Keep the message under ${BODY_MAX} characters`);
  if (!NOTIFICATION_LEVELS.includes(level as NotificationLevel)) {
    throw new NotificationInputError("Unknown notification type");
  }

  // "everyone" (or nothing), or a list of user ids
  let recipients: string[] | null = null;
  if (input.to !== undefined && input.to !== "everyone") {
    if (!Array.isArray(input.to) || !input.to.every((id) => typeof id === "string" && id)) {
      throw new NotificationInputError("Choose who gets it: everyone, or a list of users");
    }
    recipients = [...new Set(input.to as string[])];
    if (!recipients.length) throw new NotificationInputError("Choose at least one user");
    if (recipients.length > MAX_RECIPIENTS) {
      throw new NotificationInputError(`Choose at most ${MAX_RECIPIENTS} users, or send to everyone`);
    }
  }

  return { title, body: text, level: level as NotificationLevel, recipients };
}

type Viewer = Pick<StoredUser, "id" | "role">;

// What this user may see: messages to everyone or to
// them, not recalled. The super admin sees all (to manage
// them).
function visibleTo(viewer: Viewer) {
  return viewer.role === "super_admin"
    ? {}
    : { recalledAt: null, $or: [{ recipients: null }, { recipients: viewer.id }] };
}

type ReplyCounts = { replies: number; unreadReplies: number };

function toPublic(
  doc: NotificationDoc,
  read: boolean,
  viewer: Viewer,
  counts: ReplyCounts = { replies: 0, unreadReplies: 0 },
): PublicNotification {
  return {
    // Who it went to: only the super admin is told
    ...(viewer.role === "super_admin"
      ? { to: doc.recipients ? (doc.recipientNames ?? []) : null, recalled: Boolean(doc.recalledAt) }
      : {}),
    id: doc._id.toHexString(),
    title: doc.title,
    body: doc.body,
    level: doc.level,
    from: doc.createdByName,
    createdAt: doc.createdAt.toISOString(),
    read,
    ...counts,
  };
}

const isAdmin = (viewer: Viewer) => viewer.role === "super_admin";

// Replies the viewer may see: their own thread, or every
// thread for the super admin
const ownThreads = (viewer: Viewer) => (isAdmin(viewer) ? {} : { threadUserId: viewer.id });

// New to the viewer: written by the other side, not seen
const unreadFor = (viewer: Viewer) => ({ seen: false, fromAdmin: !isAdmin(viewer) });

async function replyCounts(viewer: Viewer, ids: string[]): Promise<Map<string, ReplyCounts>> {
  const { replies } = await collections();
  const rows = await replies
    .aggregate<{ _id: string; replies: number; unreadReplies: number }>([
      { $match: { notificationId: { $in: ids }, ...ownThreads(viewer) } },
      {
        $group: {
          _id: "$notificationId",
          replies: { $sum: 1 },
          unreadReplies: {
            $sum: { $cond: [{ $and: [{ $eq: ["$seen", false] }, { $eq: ["$fromAdmin", !isAdmin(viewer)] }] }, 1, 0] },
          },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, { replies: row.replies, unreadReplies: row.unreadReplies }]));
}

// Recent messages, each marked read or not for this user
export async function listNotifications(viewer: Viewer): Promise<{
  notifications: PublicNotification[];
  unread: number;
}> {
  const userId = viewer.id;
  const { notifications, reads } = await collections();
  const docs = await notifications.find(visibleTo(viewer)).sort({ createdAt: -1 }).limit(LIST_LIMIT).toArray();
  const ids = docs.map((doc) => doc._id.toHexString());

  const readIds = new Set(
    (await reads.find({ userId, notificationId: { $in: ids } }, { projection: { notificationId: 1 } }).toArray()).map(
      (doc) => doc.notificationId,
    ),
  );

  const counts = await replyCounts(viewer, ids);
  const list = docs.map((doc) => {
    const id = doc._id.toHexString();
    return toPublic(doc, readIds.has(id), viewer, counts.get(id));
  });
  return {
    notifications: list,
    // Unread messages, plus new replies
    unread: list.reduce((total, item) => total + (item.read ? 0 : 1) + item.unreadReplies, 0),
  };
}

export async function sendNotification(
  sender: Pick<StoredUser, "id" | "name" | "role">,
  input: { title: string; body: string; level: NotificationLevel; recipients: string[] | null },
): Promise<PublicNotification> {
  const { notifications, reads } = await collections();

  // Chosen users must exist; their names are kept with it
  let recipientNames: string[] | undefined;
  if (input.recipients) {
    const found = await (await usersCollection())
      .find({ _id: { $in: input.recipients } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    if (found.length !== input.recipients.length) {
      throw new NotificationInputError("Some of the chosen users no longer exist. Choose again.");
    }
    const names = new Map(found.map((user) => [user._id, user.name]));
    recipientNames = input.recipients.map((id) => names.get(id) ?? id);
  }

  const doc: NotificationDoc = {
    _id: new ObjectId(),
    title: input.title,
    body: input.body,
    level: input.level,
    recipients: input.recipients,
    ...(recipientNames ? { recipientNames } : {}),
    createdBy: sender.id,
    createdByName: sender.name,
    createdAt: new Date(),
  };
  await notifications.insertOne(doc);

  // The sender has seen their own message
  const id = doc._id.toHexString();
  await reads.updateOne(
    { _id: `${id}:${sender.id}` },
    { $setOnInsert: { notificationId: id, userId: sender.id, readAt: doc.createdAt } },
    { upsert: true },
  );

  return toPublic(doc, true, sender);
}

// `ids` read by this user; none given = all recent ones
export async function markNotificationsRead(viewer: Viewer, ids?: string[]): Promise<void> {
  const userId = viewer.id;
  const { notifications, reads } = await collections();

  const wanted = ids
    ? ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
    : undefined;
  const existing = await notifications
    .find(wanted ? { ...visibleTo(viewer), _id: { $in: wanted } } : visibleTo(viewer), { projection: { _id: 1 } })
    .sort({ createdAt: -1 })
    .limit(wanted ? wanted.length : LIST_LIMIT)
    .toArray();
  if (!existing.length) return;

  const now = new Date();
  await reads.bulkWrite(
    existing.map((doc) => {
      const id = doc._id.toHexString();
      return {
        updateOne: {
          filter: { _id: `${id}:${userId}` },
          update: { $setOnInsert: { notificationId: id, userId, readAt: now } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
}

// Takes a message back from its recipients (it leaves
// their bell and pop-ups on their next check). False when
// there was none.
export async function recallNotification(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const { notifications } = await collections();

  const result = await notifications.updateOne(
    { _id: new ObjectId(id) },
    [{ $set: { recalledAt: { $ifNull: ["$recalledAt", "$$NOW"] } } }],
  );
  return result.matchedCount > 0;
}

// Removes a message for everyone it went to. False when there was none.
export async function deleteNotification(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const { notifications, reads, replies } = await collections();

  const result = await notifications.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) return false;

  await Promise.all([reads.deleteMany({ notificationId: id }), replies.deleteMany({ notificationId: id })]);
  return true;
}

// --------------------------------------------------
// REPLIES
//
// A recipient replies to a message: only the super admin
// sees it. The super admin answers inside that person's
// thread (only that person sees it). Recalled messages
// take no replies.
// --------------------------------------------------

export class NotificationAccessError extends Error {}

// The message, if this viewer may see it
async function visibleMessage(viewer: Viewer, id: string): Promise<NotificationDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const { notifications } = await collections();
  return notifications.findOne({ ...visibleTo(viewer), _id: new ObjectId(id) });
}

function toPublicReply(doc: ReplyDoc, viewer: Viewer): PublicReply {
  return {
    id: doc._id.toHexString(),
    body: doc.body,
    author: doc.authorName,
    fromAdmin: doc.fromAdmin,
    mine: doc.authorId === viewer.id,
    createdAt: doc.createdAt.toISOString(),
  };
}

// The viewer's threads under a message (null: no such
// message for them), oldest reply first; newest thread first
export async function listReplies(viewer: Viewer, id: string): Promise<PublicThread[] | null> {
  const message = await visibleMessage(viewer, id);
  if (!message) return null;

  const { replies } = await collections();
  const docs = await replies.find({ notificationId: id, ...ownThreads(viewer) }).sort({ createdAt: 1 }).toArray();

  const threads = new Map<string, PublicThread>();
  for (const doc of docs) {
    const thread = threads.get(doc.threadUserId) ?? {
      userId: doc.threadUserId,
      userName: doc.threadUserName,
      replies: [],
      unread: 0,
    };
    thread.replies.push(toPublicReply(doc, viewer));
    if (!doc.seen && doc.fromAdmin !== isAdmin(viewer)) thread.unread += 1;
    threads.set(doc.threadUserId, thread);
  }

  const latest = (thread: PublicThread) => thread.replies[thread.replies.length - 1]?.createdAt ?? "";
  return [...threads.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}

// A reply. Recipients write in their own thread; the super
// admin answers in an existing thread (`to`: its user).
export async function addReply(
  viewer: Pick<StoredUser, "id" | "role" | "name">,
  id: string,
  input: unknown,
): Promise<PublicReply> {
  const body = typeof (input as { body?: unknown })?.body === "string" ? (input as { body: string }).body.trim() : "";
  if (!body) throw new NotificationInputError("Write a reply");
  if (body.length > REPLY_MAX) throw new NotificationInputError(`Keep replies under ${REPLY_MAX} characters`);

  const message = await visibleMessage(viewer, id);
  if (!message) throw new NotificationAccessError("Notification not found");
  if (message.recalledAt) throw new NotificationInputError("This message was recalled, so it takes no replies");

  const { replies } = await collections();
  let threadUserId = viewer.id;
  let threadUserName = viewer.name;

  if (isAdmin(viewer)) {
    const to = (input as { to?: unknown })?.to;
    const thread = typeof to === "string" ? await replies.findOne({ notificationId: id, threadUserId: to }) : null;
    if (!thread) throw new NotificationInputError("Answer someone who replied to this message");
    threadUserId = thread.threadUserId;
    threadUserName = thread.threadUserName;
  }

  const doc: ReplyDoc = {
    _id: new ObjectId(),
    notificationId: id,
    threadUserId,
    threadUserName,
    authorId: viewer.id,
    authorName: viewer.name,
    fromAdmin: isAdmin(viewer),
    body,
    createdAt: new Date(),
    seen: false,
  };
  await replies.insertOne(doc);
  return toPublicReply(doc, viewer);
}

// The viewer has seen the other side's replies (in one
// thread, for the super admin; else in their own)
export async function markRepliesSeen(viewer: Viewer, id: string, threadUserId?: string): Promise<boolean> {
  if (!(await visibleMessage(viewer, id))) return false;
  const { replies } = await collections();
  await replies.updateMany(
    {
      notificationId: id,
      ...(isAdmin(viewer) ? (threadUserId ? { threadUserId } : {}) : { threadUserId: viewer.id }),
      ...unreadFor(viewer),
    },
    { $set: { seen: true } },
  );
  return true;
}

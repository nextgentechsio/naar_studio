import { ObjectId, type Collection } from "mongodb";
import { getDb, usersCollection } from "@/lib/db/mongodb";
import type { StoredUser } from "@/lib/auth/users";
import {
  BODY_MAX,
  MAX_RECIPIENTS,
  NOTIFICATION_LEVELS,
  TITLE_MAX,
  type NotificationLevel,
  type PublicNotification,
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

const globalForNotifications = globalThis as unknown as {
  notificationIndexes?: Promise<unknown>;
};

async function collections(): Promise<{
  notifications: Collection<NotificationDoc>;
  reads: Collection<ReadDoc>;
}> {
  const db = await getDb();
  const notifications = db.collection<NotificationDoc>("notifications");
  const reads = db.collection<ReadDoc>("notificationReads");

  if (!globalForNotifications.notificationIndexes) {
    globalForNotifications.notificationIndexes = Promise.all([
      notifications.createIndex({ createdAt: -1 }),
      notifications.createIndex({ recipients: 1, createdAt: -1 }),
      reads.createIndex({ userId: 1, notificationId: 1 }),
      reads.createIndex({ notificationId: 1 }),
    ]).catch((error) => {
      globalForNotifications.notificationIndexes = undefined;
      throw error;
    });
  }
  await globalForNotifications.notificationIndexes;

  return { notifications, reads };
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

function toPublic(doc: NotificationDoc, read: boolean, viewer: Viewer): PublicNotification {
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
  };
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

  const list = docs.map((doc) => toPublic(doc, readIds.has(doc._id.toHexString()), viewer));
  return { notifications: list, unread: list.filter((item) => !item.read).length };
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
  const { notifications, reads } = await collections();

  const result = await notifications.deleteOne({ _id: new ObjectId(id) });
  if (!result.deletedCount) return false;

  await reads.deleteMany({ notificationId: id });
  return true;
}

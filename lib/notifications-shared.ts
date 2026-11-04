// --------------------------------------------------
// NOTIFICATIONS: types and limits shared by the server
// (lib/notifications.ts) and the bell in the top bar
// --------------------------------------------------

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
// A reply's length
export const REPLY_MAX = 1000;
// Chosen users per message (more: send to everyone)
export const MAX_RECIPIENTS = 200;

export const NOTIFICATION_LEVELS = ["info", "important"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export type PublicNotification = {
  id: string;
  title: string;
  body: string;
  level: NotificationLevel;
  // The sender's name
  from: string;
  createdAt: string;
  // Read by the signed-in user
  read: boolean;
  // Super admin only: names it went to; null = everyone
  to?: string[] | null;
  // Super admin only: taken back from its recipients
  recalled?: boolean;
  // Replies the viewer can see (theirs, or all for the
  // super admin), and how many of those are new to them
  replies: number;
  unreadReplies: number;
};

// A reply in the private thread between one recipient
// and the super admin, under a message
export type PublicReply = {
  id: string;
  body: string;
  author: string;
  // Written by the super admin (else by the recipient)
  fromAdmin: boolean;
  mine: boolean;
  createdAt: string;
};

export type PublicThread = {
  // The recipient this thread is with
  userId: string;
  userName: string;
  replies: PublicReply[];
  // New to the viewer
  unread: number;
};

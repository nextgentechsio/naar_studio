// --------------------------------------------------
// NOTIFICATIONS: types and limits shared by the server
// (lib/notifications.ts) and the bell in the top bar
// --------------------------------------------------

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
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
};

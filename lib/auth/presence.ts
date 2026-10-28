// --------------------------------------------------
// ONLINE PRESENCE (pure: shared by server and client)
//
// Each open, visible app tab sends a heartbeat every
// HEARTBEAT_MS. A user is online if one arrived within
// ONLINE_WINDOW_MS and they haven't signed out since.
// Only the super admin is shown this.
// --------------------------------------------------

export const HEARTBEAT_MS = 60_000;
export const ONLINE_WINDOW_MS = 2 * 60_000;
// Don't write to the database more often than this
export const HEARTBEAT_MIN_WRITE_MS = 30_000;

export type Presence = {
  online: boolean;
  lastSeenAt: string | null;
};

export function presenceOf(
  lastSeenAt: Date | null | undefined,
  signedOutAt: Date | null | undefined,
  now: number
): Presence {
  const seen = lastSeenAt?.getTime() ?? null;
  const signedOut = signedOutAt?.getTime() ?? null;

  return {
    online:
      seen !== null &&
      now - seen <= ONLINE_WINDOW_MS &&
      (signedOut === null || signedOut < seen),
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
  };
}

// "just now", "5 min ago", "3 h ago", "2 days ago"
export function formatLastSeen(lastSeenAt: string | null, now: number): string {
  if (!lastSeenAt) return "Never signed in";

  const minutes = Math.floor((now - new Date(lastSeenAt).getTime()) / 60_000);

  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `Last seen ${days} day${days === 1 ? "" : "s"} ago`;
}

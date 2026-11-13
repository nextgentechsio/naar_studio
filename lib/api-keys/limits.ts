import { RATE_LIMIT_PER_MINUTE } from "./shared";

// --------------------------------------------------
// REQUEST RATE PER KEY
//
// A sliding one-minute window, in memory. On a platform
// with several server instances each counts on its own,
// so the limit is per instance; a shared store can
// replace this without changing callers.
// --------------------------------------------------

const WINDOW_MS = 60_000;
const windows = new Map<string, number[]>();

// Seconds to wait, or null when the request may go ahead
export function rateLimited(keyId: string, now = Date.now()): number | null {
  const since = now - WINDOW_MS;
  const recent = (windows.get(keyId) ?? []).filter((at) => at > since);

  if (recent.length >= RATE_LIMIT_PER_MINUTE) {
    windows.set(keyId, recent);
    return Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
  }

  recent.push(now);
  windows.set(keyId, recent);

  // Keys that went quiet don't pile up
  if (windows.size > 10_000) {
    for (const [id, times] of windows) {
      if (times[times.length - 1] <= since) windows.delete(id);
    }
  }

  return null;
}

// Tests only
export function resetRateLimits() {
  windows.clear();
}

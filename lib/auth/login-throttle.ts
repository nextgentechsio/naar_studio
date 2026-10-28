// --------------------------------------------------
// LOGIN THROTTLE (in-memory, per username)
//
// Keyed on username only: x-forwarded-for is client
// controlled, so including it would let an attacker
// reset the counter by rotating the header.
//
// An attempt is counted when it STARTS, not after the
// (slow) password check, so a burst of parallel guesses
// can't all slip past the limit. A successful sign-in
// clears the count. The table is bounded so random
// usernames can't grow server memory without limit.
// --------------------------------------------------

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10_000;

type Entry = { count: number; firstAt: number };

export function createLoginThrottle(now: () => number = Date.now) {
  const attempts = new Map<string, Entry>();

  function prune() {
    const cutoff = now() - WINDOW_MS;

    for (const [key, entry] of attempts) {
      if (entry.firstAt < cutoff) attempts.delete(key);
    }

    // Still full of live entries: drop the oldest
    while (attempts.size >= MAX_KEYS) {
      const oldest = attempts.keys().next().value;
      if (oldest === undefined) break;
      attempts.delete(oldest);
    }
  }

  return {
    key(username: unknown): string {
      return String(username ?? "").trim().toLowerCase().slice(0, 100);
    },

    // false = blocked; true = allowed (and counted)
    tryAttempt(key: string): boolean {
      const entry = attempts.get(key);

      if (entry && now() - entry.firstAt <= WINDOW_MS) {
        if (entry.count >= MAX_ATTEMPTS) return false;
        entry.count += 1;
        return true;
      }

      if (attempts.size >= MAX_KEYS) prune();

      attempts.delete(key);
      attempts.set(key, { count: 1, firstAt: now() });
      return true;
    },

    succeeded(key: string) {
      attempts.delete(key);
    },

    size() {
      return attempts.size;
    },
  };
}

// One per server process
export const loginThrottle = createLoginThrottle();

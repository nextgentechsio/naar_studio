import { describe, expect, it } from "vitest";
import { ONLINE_WINDOW_MS, formatLastSeen, presenceOf } from "@/lib/auth/presence";

const now = Date.parse("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(now - ms);

describe("presenceOf", () => {
  it("is online within the window after a heartbeat", () => {
    expect(presenceOf(ago(10_000), null, now).online).toBe(true);
    expect(presenceOf(ago(ONLINE_WINDOW_MS), null, now).online).toBe(true);
  });

  it("goes offline when heartbeats stop", () => {
    expect(presenceOf(ago(ONLINE_WINDOW_MS + 1), null, now).online).toBe(false);
  });

  it("goes offline at once on sign-out, and back online on a later heartbeat", () => {
    expect(presenceOf(ago(30_000), ago(10_000), now).online).toBe(false);
    expect(presenceOf(ago(5_000), ago(10_000), now).online).toBe(true);
  });

  it("never seen: offline, no time", () => {
    expect(presenceOf(null, null, now)).toEqual({ online: false, lastSeenAt: null });
    expect(presenceOf(undefined, undefined, now).online).toBe(false);
  });
});

describe("formatLastSeen", () => {
  const at = (ms: number) => ago(ms).toISOString();

  it("reads naturally", () => {
    expect(formatLastSeen(null, now)).toBe("Never signed in");
    expect(formatLastSeen(at(20_000), now)).toBe("Last seen just now");
    expect(formatLastSeen(at(5 * 60_000), now)).toBe("Last seen 5 min ago");
    expect(formatLastSeen(at(3 * 3600_000), now)).toBe("Last seen 3 h ago");
    expect(formatLastSeen(at(26 * 3600_000), now)).toBe("Last seen 1 day ago");
    expect(formatLastSeen(at(72 * 3600_000), now)).toBe("Last seen 3 days ago");
  });
});

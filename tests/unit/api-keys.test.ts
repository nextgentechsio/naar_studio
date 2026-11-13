import { describe, expect, it } from "vitest";
import { generateSecret, hashSecret, looksLikeSecret } from "@/lib/api-keys/keys";
import { rateLimited, resetRateLimits } from "@/lib/api-keys/limits";
import { apiKeyStatus, capState, isMonthKey, KEY_PREFIX, monthKey, monthRange, RATE_LIMIT_PER_MINUTE } from "@/lib/api-keys/shared";
import { estimateInFlightUsd } from "@/lib/api-keys/spend";

// --------------------------------------------------
// API keys: the secret, the month maths, the cap state,
// the rate limiter and the in-flight estimate
// --------------------------------------------------

describe("the secret", () => {
  it("is long, random, prefixed and stored only as a hash", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.secret.startsWith(KEY_PREFIX)).toBe(true);
    expect(a.secret).toHaveLength(KEY_PREFIX.length + 43);
    expect(a.secret).not.toBe(b.secret);
    expect(a.prefix).toBe(a.secret.slice(0, KEY_PREFIX.length + 4));
    expect(a.hash).toBe(hashSecret(a.secret));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.secret.slice(KEY_PREFIX.length));
    expect(looksLikeSecret(a.secret)).toBe(true);
  });

  it("rejects things that aren't a key", () => {
    expect(looksLikeSecret("")).toBe(false);
    expect(looksLikeSecret("naar_live_short")).toBe(false);
    expect(looksLikeSecret(`sk_live_${"a".repeat(43)}`)).toBe(false);
    expect(looksLikeSecret(`${KEY_PREFIX}${"a".repeat(43)} `)).toBe(false);
    expect(looksLikeSecret(42)).toBe(false);
  });
});

describe("months", () => {
  it("are calendar months in UTC", () => {
    expect(monthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
    expect(monthRange("2026-11")).toEqual({ from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") });
    expect(monthRange("2026-12").to).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("26-11")).toBe(false);
  });
});

describe("the cap", () => {
  it("counts what's billed plus what's in flight", () => {
    expect(capState({ amountUsd: 5, inFlightUsd: 0 }, null)).toBe("none");
    expect(capState({ amountUsd: 5, inFlightUsd: 0 }, 10)).toBe("ok");
    expect(capState({ amountUsd: 7.5, inFlightUsd: 0.5 }, 10)).toBe("warning");
    expect(capState({ amountUsd: 9, inFlightUsd: 1 }, 10)).toBe("reached");
    expect(capState({ amountUsd: 12, inFlightUsd: 0 }, 10)).toBe("reached");
  });

  it("knows a key's state", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    expect(apiKeyStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(apiKeyStatus({ expiresAt: "2026-11-14T00:00:00Z", revokedAt: null }, now)).toBe("active");
    expect(apiKeyStatus({ expiresAt: "2026-11-13T00:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(apiKeyStatus({ expiresAt: null, revokedAt: "2026-11-01T00:00:00Z" }, now)).toBe("revoked");
  });
});

describe("the rate limiter", () => {
  it("allows a minute's worth, then says how long to wait", () => {
    resetRateLimits();
    const start = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) expect(rateLimited("k", start + i * 100)).toBeNull();
    expect(rateLimited("k", start + 30_000)).toBe(30);
    // Another key is unaffected
    expect(rateLimited("other", start + 30_000)).toBeNull();
    // A minute after the first request the window slides
    expect(rateLimited("k", start + 60_001)).toBeNull();
  });
});

describe("the in-flight estimate", () => {
  it("uses the provider's quote, else the price table, else nothing", () => {
    expect(estimateInFlightUsd({ provider: "higgsfield", model: "x", inputs: {}, quotedCostUsd: 0.4 })).toBe(0.4);
    expect(estimateInFlightUsd({ provider: "replicate", model: "google/nano-banana", inputs: { prompt: "a" }, quotedCostUsd: null })).toBeGreaterThan(0);
    expect(estimateInFlightUsd({ provider: "replicate", model: "nobody/unknown-model", inputs: {}, quotedCostUsd: null })).toBe(0);
    expect(estimateInFlightUsd({ provider: "elevenlabs", model: "x", inputs: {}, quotedCostUsd: null })).toBe(0);
    // Text to speech: by the text (1,000 characters at $0.08)
    expect(estimateInFlightUsd({ provider: "elevenlabs", model: "tts/eleven_multilingual_v2", inputs: { prompt: "a".repeat(1000) }, quotedCostUsd: null })).toBe(0.08);
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  createLoginThrottle,
} from "@/lib/auth/login-throttle";

describe("login throttle", () => {
  it("allows MAX_ATTEMPTS, then blocks, counting attempts as they start", () => {
    const throttle = createLoginThrottle(() => 0);
    const key = throttle.key("Root");

    // A parallel burst: every request is counted up front
    const results = Array.from({ length: 50 }, () => throttle.tryAttempt(key));

    expect(results.filter(Boolean)).toHaveLength(MAX_ATTEMPTS);
  });

  it("normalises the username like sign-in does", () => {
    const throttle = createLoginThrottle(() => 0);
    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.tryAttempt(throttle.key("root"));

    expect(throttle.tryAttempt(throttle.key("  ROOT "))).toBe(false);
  });

  it("resets after the window and after a successful sign-in", () => {
    let now = 0;
    const throttle = createLoginThrottle(() => now);
    const key = throttle.key("ada");

    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle.tryAttempt(key);
    expect(throttle.tryAttempt(key)).toBe(false);

    now = WINDOW_MS + 1;
    expect(throttle.tryAttempt(key)).toBe(true);

    throttle.succeeded(key);
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect(throttle.tryAttempt(key)).toBe(true);
  });

  it("stays bounded under a flood of random usernames", () => {
    const throttle = createLoginThrottle(() => 0);

    for (let i = 0; i < 25_000; i++) throttle.tryAttempt(throttle.key(`user-${i}`));

    expect(throttle.size()).toBeLessThanOrEqual(10_000);
  });

  it("caps key length", () => {
    const throttle = createLoginThrottle();
    expect(throttle.key("x".repeat(10_000))).toHaveLength(100);
  });
});

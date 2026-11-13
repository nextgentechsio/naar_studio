import type { PlatformKey } from "@/lib/auth/platforms";

// --------------------------------------------------
// NAAR STUDIO API KEYS (shared by server and browser)
//
// A key lets a script, an app or a client's system start
// generations through /api/v1 with our provider accounts.
// Every key acts as one user account and bills one of its
// projects; every run and its cost is tracked to the key
// as well, with an optional monthly cap.
// --------------------------------------------------

export const KEY_PREFIX = "naar_live_";

// Platforms a key can be given (Catalogue is the website's
// own flow, not an API)
export const API_KEY_PLATFORMS = ["replicate", "higgsfield", "elevenlabs"] as const satisfies readonly PlatformKey[];
export type ApiKeyPlatform = (typeof API_KEY_PLATFORMS)[number];

// Platforms the API can run
export const API_LIVE_PLATFORMS: readonly ApiKeyPlatform[] = [...API_KEY_PLATFORMS];

export const MAX_KEY_NAME = 60;
export const DEFAULT_CONCURRENCY = 5;
export const MAX_CONCURRENCY = 20;
export const RATE_LIMIT_PER_MINUTE = 60;
export const MAX_MONTHLY_CAP_USD = 1_000_000;

export type ApiKeySpend = {
  // The calendar month in UTC, "2026-11"
  month: string;
  // Billed this month (succeeded runs)
  amountUsd: number;
  count: number;
  // Runs in flight now, and what they're expected to cost
  inFlight: number;
  inFlightUsd: number;
};

export type PublicApiKey = {
  id: string;
  name: string;
  // The visible start of the secret, to tell keys apart
  prefix: string;
  // Who it acts as
  userId: string;
  userName: string;
  // Projects it may bill (the first is the default)
  projects: { id: string; name: string }[];
  platforms: ApiKeyPlatform[];
  monthlyCapUsd: number | null;
  concurrency: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdByName: string;
  spend: ApiKeySpend;
};

export type ApiKeyStatus = "active" | "expired" | "revoked";

export function apiKeyStatus(key: Pick<PublicApiKey, "expiresAt" | "revokedAt">, now = Date.now()): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
  return "active";
}

// "2026-11": the cap's month is a calendar month in UTC,
// the same for everyone
export function monthKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// The instants a month covers: from (inclusive) and to
// (exclusive)
export function monthRange(key: string): { from: Date; to: Date } {
  const [year, month] = key.split("-").map(Number);
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

// How the cap is doing: spent is what's billed, committed
// adds what's in flight
export type CapState = "none" | "ok" | "warning" | "reached";

export function capState(spend: Pick<ApiKeySpend, "amountUsd" | "inFlightUsd">, capUsd: number | null): CapState {
  if (capUsd === null) return "none";
  const committed = spend.amountUsd + spend.inFlightUsd;
  if (committed >= capUsd) return "reached";
  if (committed >= capUsd * 0.8) return "warning";
  return "ok";
}

// The API's one error shape
export type ApiErrorBody = { error: { code: string; message: string } };

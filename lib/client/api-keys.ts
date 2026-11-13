"use client";

import { fetchJson } from "@/lib/client/http";
import type { PublicApiKey } from "@/lib/api-keys/shared";

// --------------------------------------------------
// API KEYS (browser only): the admin page's calls
// --------------------------------------------------

export type { PublicApiKey };

export type ApiKeyFields = {
  name: string;
  userId: string;
  projectIds: string[];
  platforms: string[];
  monthlyCapUsd: number | null;
  concurrency: number;
  expiresAt: string | null;
};

const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchApiKeys(): Promise<PublicApiKey[]> {
  return (await fetchJson<{ keys: PublicApiKey[] }>("/api/admin/api-keys")).keys;
}

export async function createApiKey(fields: ApiKeyFields): Promise<{ key: PublicApiKey; secret: string }> {
  return fetchJson("/api/admin/api-keys", { method: "POST", ...json(fields) });
}

export async function updateApiKey(id: string, patch: Partial<Omit<ApiKeyFields, "userId">>): Promise<PublicApiKey> {
  return (await fetchJson<{ key: PublicApiKey }>(`/api/admin/api-keys/${encodeURIComponent(id)}`, { method: "PATCH", ...json(patch) })).key;
}

export async function revokeApiKey(id: string): Promise<PublicApiKey> {
  return (await fetchJson<{ key: PublicApiKey }>(`/api/admin/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" })).key;
}

export async function rotateApiKey(id: string): Promise<{ key: PublicApiKey; secret: string }> {
  return fetchJson(`/api/admin/api-keys/${encodeURIComponent(id)}/rotate`, { method: "POST" });
}

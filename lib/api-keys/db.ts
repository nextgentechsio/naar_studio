import type { Collection, ObjectId } from "mongodb";
import { expensesCollection, generationsCollection, getDb } from "@/lib/db/mongodb";
import type { ApiKeyPlatform } from "./shared";

// --------------------------------------------------
// API KEYS (MongoDB "apiKeys")
//
// Own collection and indexes, created here on first use
// (lib/db/mongodb.ts isn't touched). The secret itself is
// never stored: only its SHA-256 hash, and its first
// characters so admins can tell keys apart.
// --------------------------------------------------

export type ApiKeyDoc = {
  _id: ObjectId;
  name: string;
  prefix: string;
  hash: string;
  // Who the key acts as
  userId: string;
  userName: string;
  // Projects it may bill; the first is the default
  projectIds: string[];
  platforms: ApiKeyPlatform[];
  // null: no cap
  monthlyCapUsd: number | null;
  // Runs in flight at once
  concurrency: number;
  // Which cap alerts went out, for which month
  alerted?: { month: string; at80: boolean; at100: boolean };
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date | null;
  lastUsedIp?: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

const globalForApiKeys = globalThis as unknown as {
  apiKeysSetupPromise?: Promise<void>;
};

async function setup(collection: Collection<ApiKeyDoc>) {
  await Promise.all([
    collection.createIndexes([
      { key: { hash: 1 }, unique: true },
      { key: { userId: 1, createdAt: -1 } },
    ]),
    // Spend and runs by key (additive on the existing
    // collections)
    (await expensesCollection()).createIndex({ apiKeyId: 1, incurredAt: -1 }, { sparse: true }),
    (await generationsCollection()).createIndex({ apiKeyId: 1, createdAt: -1 }, { sparse: true }),
  ]);
}

export async function apiKeysCollection(): Promise<Collection<ApiKeyDoc>> {
  const collection = (await getDb()).collection<ApiKeyDoc>("apiKeys");

  if (!globalForApiKeys.apiKeysSetupPromise) {
    globalForApiKeys.apiKeysSetupPromise = setup(collection).catch((error) => {
      globalForApiKeys.apiKeysSetupPromise = undefined;
      throw error;
    });
  }

  await globalForApiKeys.apiKeysSetupPromise;
  return collection;
}

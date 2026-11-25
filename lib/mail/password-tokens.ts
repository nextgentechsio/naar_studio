import { createHash, randomBytes } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "@/lib/db/mongodb";

// --------------------------------------------------
// ONE-TIME PASSWORD LINKS (MongoDB "passwordTokens")
//
// "reset": forgot password, 1 hour. "welcome": set your
// own password from the welcome email, 7 days. Only a
// hash of the token is stored; each works once, and a
// new one replaces the user's older unused ones.
// --------------------------------------------------

export type TokenPurpose = "reset" | "welcome";

const LIFETIME_MS: Record<TokenPurpose, number> = {
  reset: 60 * 60 * 1000,
  welcome: 7 * 24 * 60 * 60 * 1000,
};

type TokenDoc = {
  // sha256 of the token
  _id: string;
  userId: string;
  purpose: TokenPurpose;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

const globalForTokens = globalThis as unknown as { passwordTokenIndexes?: Promise<unknown> };

async function tokens(): Promise<Collection<TokenDoc>> {
  const collection = (await getDb()).collection<TokenDoc>("passwordTokens");
  if (!globalForTokens.passwordTokenIndexes) {
    globalForTokens.passwordTokenIndexes = Promise.all([
      collection.createIndex({ userId: 1 }),
      // Gone a day after they end
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 }),
    ]).catch((error) => {
      globalForTokens.passwordTokenIndexes = undefined;
      throw error;
    });
  }
  await globalForTokens.passwordTokenIndexes;
  return collection;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createPasswordToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const collection = await tokens();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await collection.deleteMany({ userId, usedAt: null });
  await collection.insertOne({
    _id: hash(token),
    userId,
    purpose,
    createdAt: now,
    expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]),
    usedAt: null,
  });
  return token;
}

// Marks it used and returns its user, or null when it's
// unknown, used or expired
export async function consumePasswordToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const doc = await (await tokens()).findOneAndUpdate(
    { _id: hash(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  );
  return doc?.userId ?? null;
}

// Still usable? (the page checks before asking for a
// new password)
export async function passwordTokenValid(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return false;
  return Boolean(await (await tokens()).findOne({ _id: hash(token), usedAt: null, expiresAt: { $gt: new Date() } }));
}

// Back to unused (the new password was refused)
export async function releasePasswordToken(token: string): Promise<void> {
  await (await tokens()).updateOne({ _id: hash(token) }, { $set: { usedAt: null } });
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { canManageUser, canManageUsers } from "@/lib/auth/roles";
import { findUserById, listUsers, type StoredUser } from "@/lib/auth/users";
import { isPlatformKey } from "@/lib/auth/platforms";
import { projectsCollection } from "@/lib/db/mongodb";
import { apiKeysCollection, type ApiKeyDoc } from "./db";
import { spendByKey } from "./spend";
import {
  API_KEY_PLATFORMS,
  type ApiKeyPlatform,
  DEFAULT_CONCURRENCY,
  KEY_PREFIX,
  MAX_CONCURRENCY,
  MAX_KEY_NAME,
  MAX_MONTHLY_CAP_USD,
  type PublicApiKey,
} from "./shared";

// --------------------------------------------------
// API KEYS: create, list, change, revoke, rotate, and
// check one on a request
//
// Managers (admins and the super admin) manage keys for
// the accounts they manage, and for themselves. A key's
// owner can see it (read only) on their Account page.
// --------------------------------------------------

export type ApiKeyResult =
  | { ok: true; key: PublicApiKey; secret?: string }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ApiKeyResult => ({ ok: false, status, error });

// ---------- The secret ----------

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// naar_live_ + 43 random base62 characters (≈ 256 bits)
export function generateSecret(): { secret: string; prefix: string; hash: string } {
  const bytes = randomBytes(43);
  let body = "";
  for (const byte of bytes) body += ALPHABET[byte % ALPHABET.length];
  const secret = `${KEY_PREFIX}${body}`;
  return { secret, prefix: secret.slice(0, KEY_PREFIX.length + 4), hash: hashSecret(secret) };
}

// Long and random, so a fast hash is safe and the lookup
// is indexed
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function looksLikeSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(KEY_PREFIX) && /^[A-Za-z0-9_]{40,80}$/.test(value);
}

// ---------- Public shape ----------

type ProjectNames = Map<string, string>;

function toPublic(doc: ApiKeyDoc, projects: ProjectNames, spend: PublicApiKey["spend"]): PublicApiKey {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    prefix: doc.prefix,
    userId: doc.userId,
    userName: doc.userName,
    projects: doc.projectIds.map((id) => ({ id, name: projects.get(id) ?? "Deleted project" })),
    platforms: doc.platforms,
    monthlyCapUsd: doc.monthlyCapUsd,
    concurrency: doc.concurrency,
    expiresAt: doc.expiresAt?.toISOString() ?? null,
    revokedAt: doc.revokedAt?.toISOString() ?? null,
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    createdByName: doc.createdByName,
    spend,
  };
}

async function projectNames(ids: string[]): Promise<ProjectNames> {
  const docs = await (await projectsCollection())
    .find({ _id: { $in: [...new Set(ids)] } }, { projection: { name: 1 } })
    .toArray();
  return new Map(docs.map((doc) => [doc._id, doc.name]));
}

async function present(docs: ApiKeyDoc[]): Promise<PublicApiKey[]> {
  const [names, spend] = await Promise.all([
    projectNames(docs.flatMap((doc) => doc.projectIds)),
    spendByKey(docs.map((doc) => doc._id)),
  ]);
  return docs.map((doc) => toPublic(doc, names, spend.get(doc._id.toHexString())!));
}

export async function presentKey(doc: ApiKeyDoc): Promise<PublicApiKey> {
  return (await present([doc]))[0];
}

// ---------- Who may manage which key ----------

// The actor's own account, or one they manage
function canActFor(actor: StoredUser, owner: Pick<StoredUser, "id" | "role">): boolean {
  return canManageUsers(actor) && (owner.id === actor.id || canManageUser(actor, owner));
}

async function manageable(actor: StoredUser, id: string): Promise<ApiKeyDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const doc = await (await apiKeysCollection()).findOne({ _id: new ObjectId(id) });
  if (!doc) return null;
  const owner = await findUserById(doc.userId);
  // A deleted owner's key is the super admin's to tidy
  if (!owner) return actor.role === "super_admin" ? doc : null;
  return canActFor(actor, owner) ? doc : null;
}

// ---------- Validation ----------

type Fields = {
  name?: unknown;
  userId?: unknown;
  projectIds?: unknown;
  platforms?: unknown;
  monthlyCapUsd?: unknown;
  concurrency?: unknown;
  expiresAt?: unknown;
};

type Values = Partial<Pick<ApiKeyDoc, "name" | "projectIds" | "platforms" | "monthlyCapUsd" | "concurrency" | "expiresAt">>;

type Checked = { ok: true; values: Values } | { ok: false; status: number; error: string };

async function check(fields: Fields, owner: StoredUser, creating: boolean): Promise<Checked> {
  const values: Values = {};

  if (creating || fields.name !== undefined) {
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    if (!name || name.length > MAX_KEY_NAME) {
      return { ok: false, status: 400, error: `Name is required (up to ${MAX_KEY_NAME} characters)` };
    }
    values.name = name;
  }

  if (creating || fields.projectIds !== undefined) {
    const ids = Array.isArray(fields.projectIds) ? fields.projectIds.filter((id) => typeof id === "string") : [];
    const unique = [...new Set(ids as string[])];
    if (!unique.length) return { ok: false, status: 400, error: "Choose at least one project the key may bill" };
    const active = await (await projectsCollection()).countDocuments({ _id: { $in: unique }, status: "active" });
    if (active !== unique.length) return { ok: false, status: 400, error: "Every project must exist and be active" };
    values.projectIds = unique;
  }

  if (creating || fields.platforms !== undefined) {
    const list = Array.isArray(fields.platforms) ? fields.platforms : [];
    if (!list.length || !list.every((item) => isPlatformKey(item) && (API_KEY_PLATFORMS as readonly string[]).includes(item))) {
      return { ok: false, status: 400, error: "Choose at least one platform (Replicate, Higgsfield or ElevenLabs)" };
    }
    const platforms = API_KEY_PLATFORMS.filter((key) => list.includes(key));
    const missing = platforms.filter((key) => !owner.platforms.includes(key));
    if (missing.length) {
      return { ok: false, status: 400, error: `${owner.name} doesn't have access to ${missing.join(", ")}. Turn it on for the account first.` };
    }
    values.platforms = platforms as ApiKeyPlatform[];
  }

  if (creating || fields.monthlyCapUsd !== undefined) {
    const cap = fields.monthlyCapUsd;
    if (cap === null || cap === undefined || cap === "") values.monthlyCapUsd = null;
    else if (typeof cap === "number" && Number.isFinite(cap) && cap > 0 && cap <= MAX_MONTHLY_CAP_USD) {
      values.monthlyCapUsd = Math.round(cap * 100) / 100;
    } else return { ok: false, status: 400, error: "Monthly cap must be a positive amount in USD, or empty for no cap" };
  }

  if (creating || fields.concurrency !== undefined) {
    const value = fields.concurrency === undefined ? DEFAULT_CONCURRENCY : fields.concurrency;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_CONCURRENCY) {
      return { ok: false, status: 400, error: `Runs at once must be a whole number from 1 to ${MAX_CONCURRENCY}` };
    }
    values.concurrency = value as number;
  }

  if (creating || fields.expiresAt !== undefined) {
    const raw = fields.expiresAt;
    if (raw === null || raw === undefined || raw === "") values.expiresAt = null;
    else {
      const date = typeof raw === "string" ? new Date(raw) : null;
      if (!date || Number.isNaN(date.getTime())) return { ok: false, status: 400, error: "Expiry must be a date" };
      if (date.getTime() <= Date.now()) return { ok: false, status: 400, error: "Expiry must be in the future" };
      values.expiresAt = date;
    }
  }

  return { ok: true, values };
}

// ---------- Manage ----------

export async function createApiKey(actor: StoredUser, fields: Fields): Promise<ApiKeyResult> {
  if (!canManageUsers(actor)) return fail(403, "Forbidden");

  const ownerId = typeof fields.userId === "string" ? fields.userId : "";
  const owner = ownerId ? await findUserById(ownerId) : null;
  if (!owner || !canActFor(actor, owner)) return fail(400, "Choose an account the key acts as");
  if (owner.disabled) return fail(400, `${owner.name}'s account is disabled`);

  const checked = await check(fields, owner, true);
  if (!checked.ok) return fail(checked.status, checked.error);

  const { secret, prefix, hash } = generateSecret();
  const now = new Date();
  const doc: ApiKeyDoc = {
    _id: new ObjectId(),
    name: checked.values.name!,
    prefix,
    hash,
    userId: owner.id,
    userName: owner.name,
    projectIds: checked.values.projectIds!,
    platforms: checked.values.platforms!,
    monthlyCapUsd: checked.values.monthlyCapUsd ?? null,
    concurrency: checked.values.concurrency ?? DEFAULT_CONCURRENCY,
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    lastUsedIp: null,
    expiresAt: checked.values.expiresAt ?? null,
    revokedAt: null,
  };
  await (await apiKeysCollection()).insertOne(doc);

  return { ok: true, key: await presentKey(doc), secret };
}

// Every key the actor may manage, newest first
export async function listApiKeys(actor: StoredUser): Promise<PublicApiKey[]> {
  if (!canManageUsers(actor)) return [];
  const users = new Map((await listUsers()).map((user) => [user.id, user]));
  const docs = await (await apiKeysCollection()).find({}).sort({ createdAt: -1 }).toArray();
  const mine = docs.filter((doc) => {
    const owner = users.get(doc.userId);
    return owner ? canActFor(actor, owner) : actor.role === "super_admin";
  });
  return present(mine);
}

// The keys acting as this account (their own Account page)
export async function listOwnApiKeys(user: StoredUser): Promise<PublicApiKey[]> {
  const docs = await (await apiKeysCollection()).find({ userId: user.id }).sort({ createdAt: -1 }).toArray();
  return present(docs);
}

export async function updateApiKey(actor: StoredUser, id: string, fields: Fields): Promise<ApiKeyResult> {
  const doc = await manageable(actor, id);
  if (!doc) return fail(404, "API key not found");
  if (doc.revokedAt) return fail(409, "A revoked key can't be changed");
  const owner = await findUserById(doc.userId);
  if (!owner) return fail(409, "The account this key acts as no longer exists");

  const checked = await check(fields, owner, false);
  if (!checked.ok) return fail(checked.status, checked.error);

  const collection = await apiKeysCollection();
  await collection.updateOne({ _id: doc._id }, { $set: { ...checked.values, updatedAt: new Date() } });
  const updated = (await collection.findOne({ _id: doc._id }))!;
  return { ok: true, key: await presentKey(updated) };
}

export async function revokeApiKey(actor: StoredUser, id: string): Promise<ApiKeyResult> {
  const doc = await manageable(actor, id);
  if (!doc) return fail(404, "API key not found");
  if (doc.revokedAt) return { ok: true, key: await presentKey(doc) };
  const collection = await apiKeysCollection();
  const now = new Date();
  await collection.updateOne({ _id: doc._id }, { $set: { revokedAt: now, updatedAt: now } });
  return { ok: true, key: await presentKey({ ...doc, revokedAt: now, updatedAt: now }) };
}

// A new secret with the same settings and history; the old
// one stops working at once
export async function rotateApiKey(actor: StoredUser, id: string): Promise<ApiKeyResult> {
  const doc = await manageable(actor, id);
  if (!doc) return fail(404, "API key not found");
  if (doc.revokedAt) return fail(409, "A revoked key can't be rotated");
  const { secret, prefix, hash } = generateSecret();
  const now = new Date();
  await (await apiKeysCollection()).updateOne({ _id: doc._id }, { $set: { prefix, hash, updatedAt: now } });
  return { ok: true, key: await presentKey({ ...doc, prefix, hash, updatedAt: now }), secret };
}

// ---------- On a request ----------

export type Authenticated =
  | { ok: true; key: ApiKeyDoc; user: StoredUser }
  | { ok: false; status: number; code: string; message: string };

const unauthorized = (code: string, message: string): Authenticated => ({ ok: false, status: 401, code, message });

export async function authenticateApiKey(authorization: string | null): Promise<Authenticated> {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  const secret = match?.[1];
  if (!looksLikeSecret(secret)) {
    return unauthorized("missing_api_key", "Send your API key as `Authorization: Bearer naar_live_…`.");
  }

  const hash = hashSecret(secret);
  const doc = await (await apiKeysCollection()).findOne({ hash });
  // A found key always matches its hash; the constant-time
  // compare keeps the shape honest should the lookup change
  if (!doc || !timingSafeEqual(Buffer.from(doc.hash), Buffer.from(hash))) {
    return unauthorized("invalid_api_key", "This API key isn't recognised.");
  }
  if (doc.revokedAt) return unauthorized("revoked_api_key", "This API key was revoked.");
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    return unauthorized("expired_api_key", "This API key has expired.");
  }

  const user = await findUserById(doc.userId);
  if (!user || user.disabled) {
    return { ok: false, status: 403, code: "account_disabled", message: "The account this key acts as is disabled." };
  }

  return { ok: true, key: doc, user };
}

// lastUsedAt and the caller's address, at most once a
// minute per key
const lastTouch = new Map<string, number>();

export async function touchApiKey(doc: ApiKeyDoc, ip: string | null, now = Date.now()): Promise<void> {
  const id = doc._id.toHexString();
  if ((lastTouch.get(id) ?? 0) > now - 60_000) return;
  lastTouch.set(id, now);
  await (await apiKeysCollection()).updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date(now), lastUsedIp: ip } });
}

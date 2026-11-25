import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import type { Collection } from "mongodb";
import { promisify } from "util";
import {
  HEARTBEAT_MIN_WRITE_MS,
  presenceOf,
} from "@/lib/auth/presence";
import {
  isDuplicateKeyError,
  usersCollection,
  type UserDoc,
} from "@/lib/db/mongodb";
import {
  canAssignRole,
  canManageUser,
  isRole,
  type PublicUser,
  type Role,
} from "@/lib/auth/roles";
import {
  ALL_PLATFORMS,
  mergePlatforms,
  parsePlatforms,
  resolvePlatforms,
  type PlatformKey,
} from "@/lib/auth/platforms";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

// --------------------------------------------------
// STORAGE
//
// Every account, including the super admin, lives in
// the MongoDB "users" collection (unique index on
// username).
// --------------------------------------------------

export type StoredUser = PublicUser & {
  passwordHash: string;
  sessionVersion: number;
  sessionEndReason?: "signin" | "password";
};

function fromDoc(doc: UserDoc): StoredUser {
  return {
    id: doc._id,
    username: doc.username,
    name: doc.name,
    role: doc.role,
    disabled: doc.disabled,
    email: doc.email ?? null,
    platforms: resolvePlatforms(doc.role, doc.platforms),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    passwordHash: doc.passwordHash,
    sessionVersion: doc.sessionVersion,
    sessionEndReason: doc.sessionEndReason,
  };
}

// --------------------------------------------------
// SUPER ADMIN SEED
//
// If MongoDB has no super admin yet, create one from
// SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD. After
// that the database is the source of truth and the env
// values are ignored. Runs once per server process.
// --------------------------------------------------

const globalForSeed = globalThis as unknown as {
  superAdminSeedPromise?: Promise<void>;
};

async function seedSuperAdmin(
  users: Collection<UserDoc>
) {
  const existing = await users.findOne({
    role: "super_admin",
  });

  if (existing) return;

  const username = normalizeUsername(
    process.env.SUPER_ADMIN_USERNAME
  );
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn(
      "USERS: no super admin in MongoDB; set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in .env.local to create one"
    );
    return;
  }

  if (validatePassword(password)) {
    console.error(
      "USERS: SUPER_ADMIN_PASSWORD must be 8–200 characters; super admin not created"
    );
    return;
  }

  const now = new Date();

  try {
    await users.insertOne({
      _id: randomUUID(),
      username,
      name: username,
      role: "super_admin",
      disabled: false,
      passwordHash: await hashPassword(password),
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    console.log(
      "USERS: created super admin in MongoDB:",
      username
    );
  } catch (error) {
    // Another process seeded first, or the username
    // already belongs to a regular account.
    if (isDuplicateKeyError(error)) {
      console.error(
        `USERS: cannot create super admin; username "${username}" already exists`
      );
      return;
    }

    throw error;
  }
}

async function getUsers(): Promise<Collection<UserDoc>> {
  const users = await usersCollection();

  if (!globalForSeed.superAdminSeedPromise) {
    globalForSeed.superAdminSeedPromise = seedSuperAdmin(
      users
    ).catch((error) => {
      // Retry on the next request
      globalForSeed.superAdminSeedPromise = undefined;
      throw error;
    });
  }

  await globalForSeed.superAdminSeedPromise;

  return users;
}

// --------------------------------------------------
// PASSWORDS
// --------------------------------------------------

const KEY_LENGTH = 64;

async function hashPassword(
  password: string
): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);

  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");

  if (scheme !== "scrypt" || !saltB64 || !hashB64) {
    return false;
  }

  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(
    password,
    Buffer.from(saltB64, "base64"),
    expected.length
  );

  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

// Used when the username doesn't exist, so response
// time doesn't reveal which usernames are valid.
const DUMMY_HASH_PROMISE = hashPassword(
  randomBytes(16).toString("hex")
);

// --------------------------------------------------
// VALIDATION
// --------------------------------------------------

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const username = value.trim().toLowerCase();

  return USERNAME_PATTERN.test(username)
    ? username
    : null;
}

// One address, lowercased; "" (or null) clears it; null
// from a wrong value. The check is deliberately loose:
// something@somewhere.tld
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): { ok: true; email: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, email: null };
  if (typeof value !== "string") return { ok: false };
  const email = value.trim().toLowerCase();
  if (!email) return { ok: true, email: null };
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? { ok: true, email } : { ok: false };
}

export const EMAIL_ERROR = "Email must look like name@example.com";

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const name = value.trim();

  return name.length >= 1 && name.length <= 60
    ? name
    : null;
}

function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return "Password is required";
  }

  if (value.length < 8) {
    return "Password must be at least 8 characters";
  }

  if (value.length > 200) {
    return "Password is too long";
  }

  return null;
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    disabled: user.disabled,
    email: user.email,
    platforms: user.platforms,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Every platform is stored as "missing", so platforms
// added later are on for these accounts too
function storedPlatforms(
  role: Role,
  platforms: PlatformKey[]
): Pick<UserDoc, "platforms"> {
  if (
    role === "super_admin" ||
    ALL_PLATFORMS.every((key) => platforms.includes(key))
  ) {
    return {};
  }

  return { platforms };
}

export type UserResult =
  | { ok: true; user: PublicUser }
  | { ok: false; status: number; error: string };

function fail(
  status: number,
  error: string
): UserResult {
  return { ok: false, status, error };
}

// --------------------------------------------------
// QUERIES
// --------------------------------------------------

export async function findUserById(
  id: string
): Promise<StoredUser | null> {
  const doc = await (await getUsers()).findOne({ _id: id });

  return doc ? fromDoc(doc) : null;
}

export async function listUsers(options?: {
  withPresence?: boolean;
}): Promise<PublicUser[]> {
  const docs = await (await getUsers())
    .find({})
    .sort({ createdAt: 1 })
    .toArray();

  const now = Date.now();

  return docs.map((doc) => ({
    ...toPublicUser(fromDoc(doc)),
    ...(options?.withPresence
      ? { presence: presenceOf(doc.lastSeenAt, doc.signedOutAt, now) }
      : {}),
  }));
}

// --------------------------------------------------
// PRESENCE
// --------------------------------------------------

// Heartbeat from an open app tab. Writes at most every
// HEARTBEAT_MIN_WRITE_MS per user, however many tabs.
export async function recordHeartbeat(userId: string) {
  const now = new Date();

  await (await getUsers()).updateOne(
    {
      _id: userId,
      $or: [
        { lastSeenAt: { $exists: false } },
        { lastSeenAt: null },
        { lastSeenAt: { $lt: new Date(now.getTime() - HEARTBEAT_MIN_WRITE_MS) } },
      ],
    },
    { $set: { lastSeenAt: now } }
  );
}

// Signing out shows the user offline at once (another
// device's next heartbeat brings them back online)
export async function recordSignOut(userId: string) {
  await (await getUsers()).updateOne(
    { _id: userId },
    { $set: { signedOutAt: new Date() } }
  );
}

export async function hasAnyUsers(): Promise<boolean> {
  const count = await (
    await getUsers()
  ).countDocuments({}, { limit: 1 });

  return count > 0;
}

// `identifier`: the username, or the account's email
export async function verifyCredentials(
  identifier: unknown,
  password: unknown
): Promise<StoredUser | null> {
  const passwordText =
    typeof password === "string" ? password : "";

  let doc: UserDoc | null = null;
  if (typeof identifier === "string" && identifier.includes("@")) {
    const parsed = normalizeEmail(identifier);
    if (parsed.ok && parsed.email) {
      doc = await (await getUsers()).findOne({ email: parsed.email });
    }
  } else {
    const normalized = normalizeUsername(identifier);
    if (normalized) {
      doc = await (await getUsers()).findOne({ username: normalized });
    }
  }

  const valid = await verifyPassword(
    passwordText,
    doc?.passwordHash ?? (await DUMMY_HASH_PROMISE)
  );

  if (!doc || !valid || doc.disabled) return null;

  return fromDoc(doc);
}

// --------------------------------------------------
// MUTATIONS (actor-aware: permissions enforced here)
// --------------------------------------------------

export async function createUser(
  actor: StoredUser,
  input: {
    username?: unknown;
    name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
    platforms?: unknown;
  }
): Promise<UserResult> {
  const username = normalizeUsername(input.username);

  if (!username) {
    return fail(
      400,
      "Username must be 3–32 characters: a–z, 0–9, dot, dash or underscore"
    );
  }

  const name = normalizeName(input.name ?? username);

  if (!name) {
    return fail(400, "Name must be 1–60 characters");
  }

  if (!isRole(input.role)) {
    return fail(400, "Invalid role");
  }

  const role: Role = input.role;

  if (!canAssignRole(actor, role)) {
    return fail(
      403,
      "You are not allowed to create this role"
    );
  }

  const passwordError = validatePassword(input.password);

  if (passwordError) return fail(400, passwordError);

  const email = normalizeEmail(input.email);
  if (!email.ok) return fail(400, EMAIL_ERROR);

  // Default: what the creator has themselves
  let platforms: PlatformKey[] = actor.platforms;

  if (input.platforms !== undefined) {
    const requested = parsePlatforms(input.platforms);

    if (!requested) return fail(400, "Invalid platforms");

    const merged = mergePlatforms(actor.platforms, [], requested);

    if (!merged) {
      return fail(
        403,
        "You can only give platforms you have yourself"
      );
    }

    platforms = merged;
  }

  const now = new Date();

  const doc: UserDoc = {
    _id: randomUUID(),
    username,
    name,
    role,
    disabled: false,
    ...(email.email ? { email: email.email } : {}),
    ...storedPlatforms(role, platforms),
    passwordHash: await hashPassword(
      input.password as string
    ),
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await (await getUsers()).insertOne(doc);
  } catch (error) {
    // Unique indexes on username and email
    if (isDuplicateKeyError(error)) {
      return fail(409, duplicateMessage(error));
    }

    throw error;
  }

  return { ok: true, user: toPublicUser(fromDoc(doc)) };
}

export async function updateUser(
  actor: StoredUser,
  id: string,
  patch: {
    name?: unknown;
    email?: unknown;
    role?: unknown;
    disabled?: unknown;
    password?: unknown;
    platforms?: unknown;
  }
): Promise<UserResult> {
  const users = await getUsers();

  const doc = await users.findOne({ _id: id });

  if (!doc) return fail(404, "User not found");

  const target = fromDoc(doc);
  const isSelf = target.id === actor.id;

  // Self-service is limited to name and password (the
  // role and disabled checks below block the rest), so
  // the super admin can't lock themselves out.
  if (!isSelf && !canManageUser(actor, target)) {
    return fail(
      403,
      "You are not allowed to manage this user"
    );
  }

  const set: Partial<UserDoc> = {};
  const unset: Partial<Record<keyof UserDoc, "">> = {};
  // Bumped to revoke existing sessions
  let revokeSessions = false;

  if (patch.name !== undefined) {
    const name = normalizeName(patch.name);

    if (!name) {
      return fail(400, "Name must be 1–60 characters");
    }

    set.name = name;
  }

  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email);
    if (!email.ok) return fail(400, EMAIL_ERROR);
    if (email.email) set.email = email.email;
    else unset.email = "";
  }

  if (
    patch.role !== undefined &&
    patch.role !== target.role
  ) {
    if (isSelf) {
      return fail(400, "You cannot change your own role");
    }

    if (!isRole(patch.role)) {
      return fail(400, "Invalid role");
    }

    if (!canAssignRole(actor, patch.role)) {
      return fail(
        403,
        "You are not allowed to assign this role"
      );
    }

    set.role = patch.role;
  }

  if (
    patch.disabled !== undefined &&
    patch.disabled !== target.disabled
  ) {
    if (typeof patch.disabled !== "boolean") {
      return fail(400, "Invalid disabled value");
    }

    if (isSelf) {
      return fail(400, "You cannot disable yourself");
    }

    set.disabled = patch.disabled;
    revokeSessions = true;
  }

  if (patch.password !== undefined) {
    const passwordError = validatePassword(
      patch.password
    );

    if (passwordError) return fail(400, passwordError);

    set.passwordHash = await hashPassword(
      patch.password as string
    );
    set.sessionEndReason = "password";
    revokeSessions = true;
  }

  if (patch.platforms !== undefined) {
    const requested = parsePlatforms(patch.platforms);

    if (!requested) return fail(400, "Invalid platforms");

    if (isSelf) {
      return fail(400, "You cannot change your own platforms");
    }

    const merged = mergePlatforms(
      actor.platforms,
      target.platforms,
      requested
    );

    if (!merged) {
      return fail(
        403,
        "You can only give platforms you have yourself"
      );
    }

    const stored = storedPlatforms(
      (set.role ?? target.role) as Role,
      merged
    );

    if (stored.platforms) set.platforms = stored.platforms;
    else unset.platforms = "";
  }

  set.updatedAt = new Date();

  let updated: UserDoc | null;
  try {
    updated = await users.findOneAndUpdate(
      { _id: id },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        ...(revokeSessions
          ? { $inc: { sessionVersion: 1 } }
          : {}),
      },
      { returnDocument: "after" }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return fail(409, duplicateMessage(error));
    throw error;
  }

  if (!updated) return fail(404, "User not found");

  return {
    ok: true,
    user: toPublicUser(fromDoc(updated)),
  };
}

// Which unique index a duplicate hit
function duplicateMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  return text.includes("email") ? "That email already belongs to another account" : "Username already exists";
}

// The signed-in account changing its own email (the
// Account page); nothing else is self-service here
export async function updateOwnEmail(actor: StoredUser, email: unknown): Promise<UserResult> {
  return updateUser(actor, actor.id, { email });
}

export async function deleteUser(
  actor: StoredUser,
  id: string
): Promise<UserResult> {
  const users = await getUsers();

  const doc = await users.findOne({ _id: id });

  if (!doc) return fail(404, "User not found");

  const target = fromDoc(doc);

  if (target.id === actor.id) {
    return fail(400, "You cannot delete yourself");
  }

  if (!canManageUser(actor, target)) {
    return fail(
      403,
      "You are not allowed to manage this user"
    );
  }

  await users.deleteOne({ _id: id });

  return { ok: true, user: toPublicUser(target) };
}

// One session per account: every sign-in moves the
// session version on, so cookies issued earlier (other
// devices, other browsers) stop working. Returns the
// version to put in the new cookie. Concurrent sign-ins
// each get their own version; the last one wins.
export async function startNewSession(userId: string): Promise<number> {
  const updated = await (await getUsers()).findOneAndUpdate(
    { _id: userId },
    { $inc: { sessionVersion: 1 }, $set: { sessionEndReason: "signin" } },
    { returnDocument: "after", projection: { sessionVersion: 1 } }
  );

  if (!updated) throw new Error("User disappeared during sign-in");

  return updated.sessionVersion;
}

// --------------------------------------------------
// PASSWORD LINKS (lib/mail/password-tokens.ts): find the
// account someone asks about, and set a new password
// from a one-time link (signs out its other sessions)
// --------------------------------------------------

export async function findUserByIdentifier(identifier: unknown): Promise<StoredUser | null> {
  let doc: UserDoc | null = null;
  if (typeof identifier === "string" && identifier.includes("@")) {
    const parsed = normalizeEmail(identifier);
    if (parsed.ok && parsed.email) doc = await (await getUsers()).findOne({ email: parsed.email });
  } else {
    const normalized = normalizeUsername(identifier);
    if (normalized) doc = await (await getUsers()).findOne({ username: normalized });
  }
  return doc ? fromDoc(doc) : null;
}

export async function setPasswordFromLink(
  userId: string,
  password: unknown
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, status: 400, error: passwordError };

  const updated = await (await getUsers()).findOneAndUpdate(
    { _id: userId, disabled: { $ne: true } },
    {
      $set: {
        passwordHash: await hashPassword(password as string),
        sessionEndReason: "password",
        updatedAt: new Date(),
      },
      $inc: { sessionVersion: 1 },
    }
  );
  if (!updated) return { ok: false, status: 400, error: "This account can't be signed in to. Ask your admin." };
  return { ok: true };
}


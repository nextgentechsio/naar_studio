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
} from "@/lib/presence";
import {
  isDuplicateKeyError,
  usersCollection,
  type UserDoc,
} from "@/lib/mongodb";
import {
  canAssignRole,
  canManageUser,
  isRole,
  type PublicUser,
  type Role,
} from "@/lib/roles";

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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
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

export async function verifyCredentials(
  username: unknown,
  password: unknown
): Promise<StoredUser | null> {
  const normalized = normalizeUsername(username);
  const passwordText =
    typeof password === "string" ? password : "";

  const doc = normalized
    ? await (await getUsers()).findOne({
        username: normalized,
      })
    : null;

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
    password?: unknown;
    role?: unknown;
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

  const now = new Date();

  const doc: UserDoc = {
    _id: randomUUID(),
    username,
    name,
    role,
    disabled: false,
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
    // Unique index on username
    if (isDuplicateKeyError(error)) {
      return fail(409, "Username already exists");
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
    role?: unknown;
    disabled?: unknown;
    password?: unknown;
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
  // Bumped to revoke existing sessions
  let revokeSessions = false;

  if (patch.name !== undefined) {
    const name = normalizeName(patch.name);

    if (!name) {
      return fail(400, "Name must be 1–60 characters");
    }

    set.name = name;
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

  set.updatedAt = new Date();

  const updated = await users.findOneAndUpdate(
    { _id: id },
    {
      $set: set,
      ...(revokeSessions
        ? { $inc: { sessionVersion: 1 } }
        : {}),
    },
    { returnDocument: "after" }
  );

  if (!updated) return fail(404, "User not found");

  return {
    ok: true,
    user: toPublicUser(fromDoc(updated)),
  };
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

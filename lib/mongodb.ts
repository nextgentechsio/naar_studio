import {
  GridFSBucket,
  MongoClient,
  type Collection,
  type Db,
  type ObjectId,
} from "mongodb";
import type { Role } from "@/lib/roles";

// --------------------------------------------------
// MONGODB CONNECTION
//
// One client per server process. Cached on globalThis
// so dev hot-reloads don't open a new pool each time.
// Indexes are created once per process on first use.
// --------------------------------------------------

export type UserDoc = {
  _id: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
  passwordHash: string;
  sessionVersion: number;
  // Why the last session version bump happened, so an
  // ended session can say why: a new sign-in elsewhere
  // (one session per account) or a password change
  sessionEndReason?: "signin" | "password";
  // Presence (see lib/presence.ts)
  lastSeenAt?: Date | null;
  signedOutAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectStatus = "active" | "archived";

// Cover photo bytes live in the "projectImages" GridFS
// bucket (not public/, which doesn't persist on
// serverless hosts); the project keeps a pointer.
export type ProjectImage = {
  fileId: ObjectId;
  contentType: ProjectImageType;
  size: number;
  updatedAt: Date;
};

export const PROJECT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ProjectImageType =
  (typeof PROJECT_IMAGE_TYPES)[number];

export type ProjectDoc = {
  _id: string;
  name: string;
  // Lowercased name for case-insensitive uniqueness
  nameKey: string;
  description: string;
  status: ProjectStatus;
  // Absent on projects created before photos existed
  image?: ProjectImage | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

// One document per Replicate prediction; _id is the
// Replicate prediction id.
export type GenerationDoc = {
  _id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  provider: "replicate";
  model: string;
  version: string;
  prompt: string;
  inputs: Record<string, unknown>;
  inputImage: string | null;
  aspectRatio: string;
  resolution: string;
  status: string;
  error: string | null;
  costUsd: number | null;
  // Replicate's URL (expires) and our saved copy
  outputUrl: string | null;
  // URL of our saved copy: /api/generations/<id>/output
  // (older records: /history/<file> in public/)
  localOutputUrl: string | null;
  // The saved copy in GridFS "generationOutputs"
  outputFileId?: ObjectId | null;
  outputContentType?: string | null;
  outputSize?: number | null;
  // Saved copy deleted by the retention cleanup
  // (lib/output-retention.ts)
  outputExpiredAt?: Date | null;
  predictTime: number | null;
  // Reconcile attempts that found no prediction
  reconcileFailures?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

// Expense ledger: one entry per billed (succeeded)
// generation; _id is the generation/prediction id so
// an expense can never be recorded twice.
export type ExpenseDoc = {
  _id: string;
  generationId: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  provider: "replicate";
  model: string;
  // null = model has no known price (counted, flagged)
  amountUsd: number | null;
  currency: "USD";
  // From our price table, not a Replicate invoice
  pricingSource: "estimated";
  incurredAt: Date;
  createdAt: Date;
};

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
  mongoSetupPromise?: Promise<void>;
};

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing in .env.local");
  }

  if (!globalForMongo.mongoClientPromise) {
    globalForMongo.mongoClientPromise = new MongoClient(uri)
      .connect()
      .catch((error) => {
        // Allow a retry on the next request
        globalForMongo.mongoClientPromise = undefined;
        throw error;
      });
  }

  return globalForMongo.mongoClientPromise;
}

async function setupIndexes(db: Db) {
  await Promise.all([
    db
      .collection<UserDoc>("users")
      .createIndex({ username: 1 }, { unique: true }),
    db
      .collection<ProjectDoc>("projects")
      .createIndex({ nameKey: 1 }, { unique: true }),
    db.collection<GenerationDoc>("generations").createIndexes([
      { key: { createdAt: -1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { projectId: 1, createdAt: -1 } },
      { key: { status: 1, createdAt: -1 } },
    ]),
    db.collection<ExpenseDoc>("expenses").createIndexes([
      { key: { incurredAt: -1 } },
      { key: { userId: 1, incurredAt: -1 } },
      { key: { projectId: 1, incurredAt: -1 } },
    ]),
  ]);
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB || "ai_studio");

  if (!globalForMongo.mongoSetupPromise) {
    globalForMongo.mongoSetupPromise = setupIndexes(db).catch(
      (error) => {
        globalForMongo.mongoSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalForMongo.mongoSetupPromise;

  return db;
}

export async function usersCollection(): Promise<
  Collection<UserDoc>
> {
  return (await getDb()).collection<UserDoc>("users");
}

export async function projectsCollection(): Promise<
  Collection<ProjectDoc>
> {
  return (await getDb()).collection<ProjectDoc>("projects");
}

export async function generationsCollection(): Promise<
  Collection<GenerationDoc>
> {
  return (await getDb()).collection<GenerationDoc>(
    "generations"
  );
}

export async function expensesCollection(): Promise<
  Collection<ExpenseDoc>
> {
  return (await getDb()).collection<ExpenseDoc>("expenses");
}

export async function projectImagesBucket(): Promise<GridFSBucket> {
  return new GridFSBucket(await getDb(), {
    bucketName: "projectImages",
  });
}

// Saved copies of finished runs' outputs
export async function generationOutputsBucket(): Promise<GridFSBucket> {
  return new GridFSBucket(await getDb(), {
    bucketName: "generationOutputs",
  });
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

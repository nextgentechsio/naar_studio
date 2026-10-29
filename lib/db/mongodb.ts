import {
  GridFSBucket,
  MongoClient,
  type Collection,
  type Db,
  type ObjectId,
} from "mongodb";
import type { Role } from "@/lib/auth/roles";

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
  // Presence (see lib/auth/presence.ts)
  lastSeenAt?: Date | null;
  signedOutAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectStatus = "active" | "archived";

// Cover photo bytes live in Vercel Blob (blobUrl,
// never sent to browsers) or, for older photos, the
// "projectImages" GridFS bucket (fileId). Blob wins when
// both are set. Not public/: it doesn't persist on
// serverless hosts.
export type ProjectImage = {
  blobUrl?: string | null;
  fileId?: ObjectId | null;
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
// Who ran a generation (and bills it)
export type Provider = "replicate" | "higgsfield" | "elevenlabs";

const PROVIDERS: Provider[] = ["replicate", "higgsfield", "elevenlabs"];

// "Replicate", "Higgsfield", "ElevenLabs"
export function providerName(provider: Provider | undefined): string {
  return provider === "higgsfield" ? "Higgsfield" : provider === "elevenlabs" ? "ElevenLabs" : "Replicate";
}

export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

// Records from one platform. Older records have no
// provider: they're all Replicate (the others came later).
export function providerMatch(provider: Provider) {
  return provider === "replicate"
    ? { provider: { $nin: ["higgsfield" as const, "elevenlabs" as const] } }
    : { provider };
}

export type GenerationDoc = {
  _id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  provider: Provider;
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
  // "billed": costUsd is what Higgsfield charged, not
  // our estimate (lib/spend/higgsfield-billing.ts)
  costSource?: "billed";
  // Higgsfield's price for the run, quoted when it
  // started (billed if it succeeds)
  quotedCostUsd?: number | null;
  // Replicate's URL (expires) and our saved copy
  outputUrl: string | null;
  // URL of our saved copy: /api/generations/<id>/output
  // (older records: /history/<file> in public/)
  localOutputUrl: string | null;
  // The saved copy: in Vercel Blob (newer records, and
  // older ones once migrated; never sent to browsers) or
  // in GridFS "generationOutputs". Blob wins when both
  // are set.
  outputBlobUrl?: string | null;
  outputFileId?: ObjectId | null;
  outputContentType?: string | null;
  outputSize?: number | null;
  // Set while one request copies the output to storage
  outputSavingUntil?: Date | null;
  // Saved copy deleted by the retention cleanup
  // (lib/storage/output-retention.ts)
  outputExpiredAt?: Date | null;
  // Hidden by the super admin: then only they can see it
  // (its cost still counts in Expenses)
  hiddenAt?: Date | null;
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
  provider: Provider;
  model: string;
  // null = model has no known price (counted, flagged)
  amountUsd: number | null;
  currency: "USD";
  // "estimated": our price table or the provider's quote.
  // "billed": what Higgsfield's usage says it charged
  // (lib/spend/higgsfield-billing.ts)
  pricingSource: "estimated" | "billed";
  incurredAt: Date;
  createdAt: Date;
};

// The media library: input files a user uploaded, kept
// in Vercel Blob (library/<userId>/) until they delete
// them, so they can be reused in later runs
export type LibraryFileDoc = {
  _id: ObjectId;
  userId: string;
  url: string;
  pathname: string;
  name: string;
  kind: "image" | "video" | "audio";
  contentType: string;
  size: number;
  // Copied from this run's output ("Add to element")
  fromGenerationId?: string;
  createdAt: Date;
};

// A saved element: a named character, product or object
// with reference images (library files), mentioned in a
// prompt as @name (see lib/elements.ts)
export type ElementDoc = {
  _id: ObjectId;
  userId: string;
  name: string;
  // Lowercased name: unique per user
  nameKey: string;
  description: string;
  images: string[];
  // Reference videos and voice clips (missing on
  // elements made before they could hold them)
  videos?: string[];
  audios?: string[];
  createdAt: Date;
  updatedAt: Date;
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
    // Lists sort newest first with _id breaking ties, so
    // the indexes end the same way and Mongo can walk
    // them in order instead of sorting in memory
    db.collection<GenerationDoc>("generations").createIndexes([
      { key: { createdAt: -1, _id: -1 } },
      { key: { userId: 1, createdAt: -1, _id: -1 } },
      { key: { projectId: 1, createdAt: -1, _id: -1 } },
      { key: { status: 1, createdAt: -1, _id: -1 } },
    ]),
    db.collection<ExpenseDoc>("expenses").createIndexes([
      { key: { incurredAt: -1, _id: -1 } },
      { key: { userId: 1, incurredAt: -1, _id: -1 } },
      { key: { projectId: 1, incurredAt: -1 } },
    ]),
    db.collection<LibraryFileDoc>("libraryFiles").createIndexes([
      { key: { userId: 1, kind: 1, createdAt: -1, _id: -1 } },
      { key: { url: 1 }, unique: true },
    ]),
    db.collection<ElementDoc>("elements").createIndexes([
      { key: { userId: 1, nameKey: 1 }, unique: true },
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

export async function libraryFilesCollection(): Promise<
  Collection<LibraryFileDoc>
> {
  return (await getDb()).collection<LibraryFileDoc>("libraryFiles");
}

export async function elementsCollection(): Promise<
  Collection<ElementDoc>
> {
  return (await getDb()).collection<ElementDoc>("elements");
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

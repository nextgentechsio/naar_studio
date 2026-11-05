import type { Collection, ObjectId } from "mongodb";
import { getDb } from "@/lib/db/mongodb";
import type {
  AssetKind,
  Crop,
  Gender,
  ImageModelId,
  InputSlot,
  ProductStatus,
  Resolution,
  ShotDefinition,
} from "./shared";

// --------------------------------------------------
// CATALOGUE: its own collections (lib/db/mongodb.ts is
// not touched; indexes are created once per process)
// --------------------------------------------------

export type AssetDoc = {
  _id: ObjectId;
  kind: AssetKind;
  name: string;
  prompt: string;
  notes: string;
  gender: Gender | null;
  setting: "studio" | "lifestyle" | null;
  imageUrl: string | null;
  status: "active" | "archived";
  // Built-in presets (lib/catalogue/presets.ts)
  presetKey?: string;
  // A deleted built-in (kept so it isn't re-seeded)
  deleted?: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TemplateDoc = {
  _id: ObjectId;
  name: string;
  description: string;
  styling: string;
  categories: string[];
  shots: ShotDefinition[];
  status: "active" | "archived";
  presetKey?: string;
  // A deleted built-in (kept so it isn't re-seeded)
  deleted?: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductDoc = {
  _id: ObjectId;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  name: string;
  sku: string;
  category: string;
  gender: Gender;
  notes: string;
  templateId: string | null;
  // The template's shots, copied when it's chosen, so
  // later template edits don't move a running product
  plan: ShotDefinition[];
  styling: string;
  modelId: string | null;
  poseId: string | null;
  backgroundId: string | null;
  accessoryIds: string[];
  inputs: Partial<Record<InputSlot, string>>;
  imageModel: ImageModelId;
  resolution: Resolution;
  status: ProductStatus;
  // shotId → generation id of the version in use
  selected: Record<string, string>;
  // shotId → pose / background chosen for that shot at
  // approve (or when regenerating with a new pose); wins
  // over the template's and the product's. Missing on
  // older products.
  poseOverrides?: Record<string, string>;
  backgroundOverrides?: Record<string, string>;
  // generation id → its crop (display and download only;
  // references always use the full image)
  crops?: Record<string, Crop>;
  createdAt: Date;
  updatedAt: Date;
};

// One image run of one shot (a Naar generation)
export type RunDoc = {
  // The generation id
  _id: string;
  productId: string;
  shotId: string;
  userId: string;
  model: string;
  feedback: string;
  status: "pending" | "succeeded" | "failed";
  imageUrl: string | null;
  error: string | null;
  // Someone is copying the output (only one at a time)
  copyingUntil?: Date | null;
  // What was actually sent (the original's per-shot
  // trace): the final prompt and the references in order
  prompt?: string;
  references?: { role: string; url: string }[];
  // When the provider call began (direct runs wait in the
  // queue first; stale checks count from here)
  startedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// A direct (Google / OpenAI) image call waiting for, or
// holding, one of the global call slots (lib/catalogue/
// queue.ts). _id = the generation id.
export type JobDoc = {
  _id: string;
  productId: string | null;
  engine: "google" | "openai";
  request: {
    model: string;
    prompt: string;
    references: string[];
    resolution: Resolution;
    quality?: "low" | "medium" | "high";
  };
  status: "queued" | "running" | "done";
  // Calls made so far, and when a retry may start
  attempts?: number;
  notBefore?: Date | null;
  // The slot it holds while running, and until when
  slot: number | null;
  leaseUntil: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

// The global limit on direct calls in flight: one doc per
// slot, taken atomically (_id 0..N-1)
export type SlotDoc = { _id: number; jobId: string | null; leaseUntil: Date };
// Calls in flight per product (_id = product id), raised
// only while under the limit
export type ProductSlotDoc = { _id: string; count: number; updatedAt?: Date };

const globalForCatalogue = globalThis as unknown as {
  catalogueIndexes?: Promise<unknown>;
};

export async function catalogueCollections(): Promise<{
  assets: Collection<AssetDoc>;
  templates: Collection<TemplateDoc>;
  products: Collection<ProductDoc>;
  runs: Collection<RunDoc>;
  jobs: Collection<JobDoc>;
  slots: Collection<SlotDoc>;
  productSlots: Collection<ProductSlotDoc>;
}> {
  const db = await getDb();
  const assets = db.collection<AssetDoc>("catalogueAssets");
  const templates = db.collection<TemplateDoc>("catalogueTemplates");
  const products = db.collection<ProductDoc>("catalogueProducts");
  const runs = db.collection<RunDoc>("catalogueRuns");
  const jobs = db.collection<JobDoc>("catalogueJobs");
  const slots = db.collection<SlotDoc>("catalogueSlots");
  const productSlots = db.collection<ProductSlotDoc>("catalogueProductSlots");

  if (!globalForCatalogue.catalogueIndexes) {
    const preset = { unique: true, partialFilterExpression: { presetKey: { $type: "string" } } };
    globalForCatalogue.catalogueIndexes = Promise.all([
      assets.createIndex({ kind: 1, status: 1, name: 1 }),
      assets.createIndex({ presetKey: 1 }, preset),
      templates.createIndex({ status: 1, name: 1 }),
      templates.createIndex({ presetKey: 1 }, preset),
      products.createIndex({ userId: 1, updatedAt: -1 }),
      products.createIndex({ updatedAt: -1 }),
      runs.createIndex({ productId: 1, shotId: 1, createdAt: -1 }),
      runs.createIndex({ status: 1, createdAt: -1 }),
      jobs.createIndex({ status: 1, createdAt: 1 }),
      jobs.createIndex({ productId: 1, status: 1 }),
    ]).catch((error) => {
      globalForCatalogue.catalogueIndexes = undefined;
      throw error;
    });
  }
  await globalForCatalogue.catalogueIndexes;

  return { assets, templates, products, runs, jobs, slots, productSlots };
}

// Blob folders (output retention only prunes outputs/
// and inputs/, so these are kept)
export const CATALOGUE_PREFIX = "catalogue/";
export const libraryFolder = () => `${CATALOGUE_PREFIX}library/`;
export const productFolder = (userId: string, productId: string) =>
  `${CATALOGUE_PREFIX}${userId}/products/${productId}/`;

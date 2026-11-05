import type { Collection, ObjectId } from "mongodb";
import { getDb } from "@/lib/db/mongodb";
import type {
  AssetKind,
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
  createdAt: Date;
  updatedAt: Date;
};

const globalForCatalogue = globalThis as unknown as {
  catalogueIndexes?: Promise<unknown>;
};

export async function catalogueCollections(): Promise<{
  assets: Collection<AssetDoc>;
  templates: Collection<TemplateDoc>;
  products: Collection<ProductDoc>;
  runs: Collection<RunDoc>;
}> {
  const db = await getDb();
  const assets = db.collection<AssetDoc>("catalogueAssets");
  const templates = db.collection<TemplateDoc>("catalogueTemplates");
  const products = db.collection<ProductDoc>("catalogueProducts");
  const runs = db.collection<RunDoc>("catalogueRuns");

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
    ]).catch((error) => {
      globalForCatalogue.catalogueIndexes = undefined;
      throw error;
    });
  }
  await globalForCatalogue.catalogueIndexes;

  return { assets, templates, products, runs };
}

// Blob folders (output retention only prunes outputs/
// and inputs/, so these are kept)
export const CATALOGUE_PREFIX = "catalogue/";
export const libraryFolder = () => `${CATALOGUE_PREFIX}library/`;
export const productFolder = (userId: string, productId: string) =>
  `${CATALOGUE_PREFIX}${userId}/products/${productId}/`;

// --------------------------------------------------
// CATALOGUE: types and limits shared by the server
// (lib/catalogue/*) and the pages (app/(studio)/catalogue)
//
// A product (one garment / SKU) goes through:
//   draft → initial look (one image, retry with feedback)
//   → approved → every other shot of its template,
// each shot keeping its versions. Every image is a normal
// Naar generation (History, Expenses), linked here.
// --------------------------------------------------

export const GENDERS = ["female", "male"] as const;
export type Gender = (typeof GENDERS)[number];

export const CATEGORIES = [
  "Tops",
  "Shirts",
  "T-shirts",
  "Dresses",
  "Bottoms",
  "Co-ords",
  "Outerwear",
  "Ethnic wear",
  "Sarees",
  "Activewear",
  "Kidswear",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Garment photo slots on a product, in upload order
export const INPUT_SLOTS = [
  { key: "front", label: "Front", required: true, hint: "Garment front, flat lay or on a mannequin" },
  { key: "back", label: "Back", required: false, hint: "Garment back" },
  { key: "detail", label: "Detail", required: false, hint: "Fabric, print or trim close-up" },
  { key: "extra", label: "Extra view", required: false, hint: "Any other angle" },
  { key: "pairing", label: "Pairing", required: false, hint: "What it's worn with (e.g. jeans)" },
  { key: "footwear", label: "Footwear", required: false, hint: "Shoes to style it with" },
] as const;
export type InputSlot = (typeof INPUT_SLOTS)[number]["key"];

// Image models. "google:" / "openai:" are called directly
// with the original catalogue's keys (lib/catalogue/direct.ts,
// priced from the tokens used); the others go through
// Replicate (priced in lib/replicate/cost.ts). Either way
// each image is a generation billed to the project.
export const IMAGE_MODELS = [
  {
    id: "google:gemini-nano-banana-2.1",
    label: "Nano Banana 2.1",
    via: "Google",
    hint: "The original catalogue's default. Best likeness",
    maxRefs: 8,
  },
  {
    id: "openai:gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    via: "OpenAI",
    hint: "Crisp studio look; slower",
    maxRefs: 16,
  },
  {
    id: "google/nano-banana-2",
    label: "Nano Banana 2",
    via: "Replicate",
    hint: "Same family, through Replicate",
    maxRefs: 14,
  },
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5",
    via: "Replicate",
    hint: "Same model, through Replicate",
    maxRefs: 16,
  },
] as const;
export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
// Replicate's Nano Banana 2 until the Google key can make
// images (its project is on the free tier, which can't)
export const DEFAULT_IMAGE_MODEL: ImageModelId = "google/nano-banana-2";

export const RESOLUTIONS = ["1K", "2K"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// ---------- Library ----------

export const ASSET_KINDS = ["model", "pose", "background", "accessory"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_LABELS: Record<AssetKind, string> = {
  model: "Models",
  pose: "Poses",
  background: "Backgrounds",
  accessory: "Accessories",
};

export type PublicAsset = {
  id: string;
  kind: AssetKind;
  name: string;
  // model: who they are (age, look, build); pose: the
  // POSE / MOOD / CAMERA brief; background: the scene;
  // accessory: what it is and how it's worn
  prompt: string;
  // model only: how they wear clothes (fit, styling)
  notes: string;
  // model / pose only; null = any
  gender: Gender | null;
  // background only
  setting: "studio" | "lifestyle" | null;
  // Reference photo (face for a model), or null for
  // text-only presets
  imageUrl: string | null;
  status: "active" | "archived";
  builtIn: boolean;
  updatedAt: string;
};

// ---------- Templates ----------

export const SHOT_TYPES = [
  "initial",
  "front",
  "back",
  "side",
  "closeup",
  "detail",
  "lifestyle",
  "full",
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export type ShotDefinition = {
  // Stable within the template ("front", "back-2"...)
  id: string;
  label: string;
  type: ShotType;
  // What this shot is (framing, angle, crop); {{vars}}
  // are filled from the product
  prompt: string;
  // Pose / background preferred for this shot; empty =
  // the product's choice (or the initial look's)
  poseId: string | null;
  backgroundId: string | null;
};

export type PublicTemplate = {
  id: string;
  name: string;
  description: string;
  // Styling direction added to every shot
  styling: string;
  categories: string[];
  // The first shot is always the initial look
  shots: ShotDefinition[];
  status: "active" | "archived";
  builtIn: boolean;
  updatedAt: string;
};

// ---------- Products ----------

export type ProductStatus =
  | "draft" // details / uploads
  | "initial" // working on the initial look
  | "shooting" // approved; other shots generating
  | "done";

export type ShotRun = {
  // The Naar generation id (History / Expenses)
  generationId: string;
  status: "pending" | "succeeded" | "failed";
  // Our permanent copy (Blob catalogue/…); null until done
  imageUrl: string | null;
  error: string | null;
  feedback: string;
  model: string;
  createdAt: string;
};

export type ProductShot = {
  shotId: string;
  label: string;
  // Newest first
  runs: ShotRun[];
  // The version in use (a succeeded run), or null
  selected: string | null;
};

export type PublicProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  gender: Gender;
  notes: string;
  project: { id: string; name: string };
  templateId: string | null;
  modelId: string | null;
  poseId: string | null;
  backgroundId: string | null;
  accessoryIds: string[];
  inputs: Partial<Record<InputSlot, string>>;
  imageModel: ImageModelId;
  resolution: Resolution;
  status: ProductStatus;
  // The initial look first, then the template's other shots
  shots: ProductShot[];
  // Total of its finished runs (from expenses), USD
  spendUsd: number;
  // Once anything ran, the project can't change (its
  // costs are already counted there)
  projectLocked: boolean;
  owner: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type ProductSummary = Pick<
  PublicProduct,
  "id" | "name" | "sku" | "category" | "status" | "project" | "owner" | "updatedAt"
> & {
  cover: string | null;
  shotCount: number;
  // Finished images, and what all its runs cost (from
  // expenses, so it matches Expenses for the project)
  images: number;
  spendUsd: number;
};

export const NAME_MAX = 120;
export const PROMPT_MAX = 4000;
export const FEEDBACK_MAX = 1000;
export const MAX_ACCESSORIES = 3;
export const MAX_SHOTS = 12;

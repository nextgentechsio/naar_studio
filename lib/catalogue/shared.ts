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
  "Top wear",
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

// Categories that were renamed: values saved under the
// old name read as the new one
const RENAMED_CATEGORIES: Record<string, Category> = { Tops: "Top wear" };
export const categoryName = (value: string): string => RENAMED_CATEGORIES[value] ?? value;

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

// Image models: the original catalogue's two
// (GENERATION_MODEL_OPTIONS), called directly with its
// keys, NANO_BANANA_API_KEY and OPENAI_API_KEY
// (lib/catalogue/direct.ts). No Replicate.
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
    label: "Sunburst",
    via: "OpenAI",
    hint: "GPT Image 2.5 Sunburst. Crisp studio look; slower",
    maxRefs: 16,
  },
] as const;
export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
export const DEFAULT_IMAGE_MODEL: ImageModelId = "google:gemini-nano-banana-2.1";

// Products saved while Replicate models were offered move
// to the same model, called directly
export function imageModelOf(stored: string | null | undefined): ImageModelId {
  if (IMAGE_MODELS.some((model) => model.id === stored)) return stored as ImageModelId;
  return /sunburst|gpt-image/.test(stored ?? "") ? "openai:gpt-image-2.5-sunburst" : DEFAULT_IMAGE_MODEL;
}

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

// Part of an image to show and download: fractions
// (0-1) of its width and height. The full image is kept,
// so a crop can be changed or removed later.
export type Crop = { x: number; y: number; w: number; h: number };

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
  // When the image call began; null while it waits its
  // turn in the queue
  startedAt: string | null;
  // How this version is cropped; null: the whole image
  crop: Crop | null;
};

export type ProductShot = {
  shotId: string;
  label: string;
  type: ShotType;
  // What the template set for this shot (null: none)
  templatePoseId: string | null;
  templateBackgroundId: string | null;
  // Chosen for this product's shot (approve / change
  // pose); null: the template's, else the product's
  poseId: string | null;
  backgroundId: string | null;
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
  // An image is being made right now
  generating: boolean;
};

export const NAME_MAX = 120;
export const PROMPT_MAX = 4000;
export const FEEDBACK_MAX = 1000;
export const MAX_ACCESSORIES = 3;
export const MAX_SHOTS = 12;

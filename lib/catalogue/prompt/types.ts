// --------------------------------------------------
// CATALOGUE: prompt builder types (public context + the
// original's internal reference shape)
// --------------------------------------------------

import type { Gender, PublicAsset, ShotDefinition } from "../shared";
import type { GarmentSlot, OriginalShotType, PatternSlot } from "./constants";

export type RefRole =
  | "garment_front"
  | "garment_back"
  | "garment_detail"
  // An extra garment angle; `slot` says which (default front_extra)
  | "garment_extra"
  | "pairing"
  | "footwear"
  | "model_face"
  | "background"
  // A catalog accessory (label = its name), or an uploaded
  // one (`uploaded: true`, label = the user's label)
  | "accessory"
  | "initial_look"
  // Not in the original: the attempt being corrected (sent
  // only with feedback, ranked like the original's `reference`)
  | "previous"
  // Pose photo; only sent when ctx.poseAsImage (the
  // original has POSE_AS_IMAGE = false)
  | "pose"
  // Pattern swatch (crop of a print); `slot` = pattern_front…
  | "pattern"
  // User-supplied regeneration reference image
  | "reference"
  // Output only: a pre-merged composite (stylingComposites)
  | "styling";

export type Reference = {
  role: RefRole;
  url: string;
  label?: string;
  // garment_extra / pattern only
  slot?: GarmentSlot | PatternSlot;
  // accessory only: uploaded with the product (not the library)
  uploaded?: boolean;
};

// estimateSkinDepthFromImage (utils/imageProcessing.js)
export type SkinDepthNote = {
  label: string;
  fitzpatrick: string | number;
  isDark: boolean;
};

export type PromptContext = {
  shot: ShotDefinition;
  isInitial: boolean;
  product: { name: string; category: string; gender: Gender; notes: string };
  // Template styling. Used as the original's
  // modelAppearanceNotes (with the model's own prompt)
  // unless modelDescription is given.
  styling: string;
  model: PublicAsset | null;
  pose: PublicAsset | null;
  background: PublicAsset | null;
  accessories: PublicAsset[];
  feedback: string;
  // Every input the product has; the builder picks per shot
  references: Reference[];
  // referenceCapForModel
  maxRefs: number;

  // ---------- Optional (phase B/C data) ----------
  // One of the original's 13 shot keys; overrides the
  // mapping from shot.type
  shotType?: OriginalShotType;
  // Regenerate of a later shot: fullInputRefs (all garment
  // views, styling and accessories, not the slimmed set)
  regenerate?: boolean;
  // Measured from the model face photo; null = unmeasured
  skinDepth?: SkinDepthNote | null;
  // resolveModelDescription pick from the template's
  // male/female (or Sunburst) lists. Replaces styling+model.
  modelDescription?: string | null;
  // The pose's wearStyleNotes (and its product category
  // restriction, matched against productCategoryId)
  poseWearStyleNotes?: string | null;
  poseProductCategories?: string[];
  productCategoryId?: string | null;
  // shot.inheritInitialLookBackground (default true)
  inheritBackground?: boolean;
  // 1024² face crop of the model photo (cropFaceIdentityReference)
  faceCropUrl?: string | null;
  // Send the pose photo as an image (POSE_AS_IMAGE)
  poseAsImage?: boolean;
  // Composites already made (composeStylingReference) of
  // exactly the items present: pairing+footwear (≥2 items),
  // accessories (≥2), and all styling items (when packing
  // to the cap). Absent = the original's fallback when
  // compositing fails (items sent one by one).
  stylingComposites?: {
    pairingFootwear?: string | null;
    accessories?: string | null;
    outfit?: string | null;
  };
};

// The original's reference shape (role names as in
// productGeneration.js)
export type OrigRole =
  | "garment"
  | "model"
  | "initial"
  | "pose"
  | "background"
  | "pairing"
  | "footwear"
  | "accessories"
  | "styling"
  | "pattern"
  | "reference"
  | "previous";

export type OrigRef = {
  role: OrigRole;
  url: string;
  slot?: string;
  label?: string;
  source: Reference;
};

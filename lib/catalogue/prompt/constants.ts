// --------------------------------------------------
// CATALOGUE: prompt constants, ported word for word from
// ai-catalog-backend (origin/feat/rda-catalog-migration):
//   src/constants/outputSharpness.js
//   src/constants/garmentColorLock.js
//   src/constants/promptVariables.js
//   src/constants/shotPromptTemplates.js
//   src/constants/dynamicShots.js
//   src/constants/catalogReferenceQuality.js
//   src/validators/product.js (slot lists)
//   src/services/productGeneration.js (GARMENT_SLOT_LABEL…)
// --------------------------------------------------

// ---------- Shot types (the original's 13 keys) ----------

export const ORIGINAL_SHOT_TYPES = [
  "front",
  "front_full_sleeve",
  "back",
  "side",
  "initial",
  "closeup",
  "closeup_front",
  "closeup_back",
  "closeup_dynamic_front",
  "closeup_dynamic_back",
  "lifestyle",
  "dynamic_lifestyle",
  "mood",
] as const;
export type OriginalShotType = (typeof ORIGINAL_SHOT_TYPES)[number];

// ---------- outputSharpness.js ----------

// Appended to every image prompt (generation, regeneration, edits) to steer away from soft, low-detail output.
export const OUTPUT_SHARPNESS =
  "OUTPUT QUALITY: render as an ultra-high-resolution 8K-quality photograph — tack-sharp focus, crisp fabric texture, weave, print and stitching, clean edges, fine hair and skin detail. No blur, no softness, no haze, no smudged or smeared print, no noise, no compression artifacts, no upscaling halos.";

export function withOutputSharpness(prompt: string): string {
  const text = String(prompt ?? "");
  return text.includes(OUTPUT_SHARPNESS) ? text : `${text}\n\n${OUTPUT_SHARPNESS}`;
}

// ---------- garmentColorLock.js ----------
// (RDA engine only; the legacy buildPrompt has its own
// longer GARMENT COLOR block. Kept for phase C / RDA.)

export const GARMENT_COLOR_LOCK =
  "GARMENT COLOR — DO NOT CHANGE: the garment's own color never changes from its reference photo. Do not recolor it, do not make it lighter or darker, do not shift it toward any other hue, even to \"match\" the background, skin tone, or scene mood. The ONLY thing allowed to vary with the scene is how light falls on it — natural highlight and shadow from the light source, exactly as it would on a real garment of that exact color in that exact light; the fabric's base color underneath that light and shadow stays pixel-identical to the reference. If the fabric is dark-wash, deep-toned, or near-black, it must still read as dark-wash, deep-toned, or near-black after lighting is applied — never softened into a mid-tone or faded look.";

// ---------- validators/product.js ----------

export const GARMENT_SLOTS = [
  "front",
  "back",
  "detail",
  "front_extra",
  "front_extra_2",
  "back_extra",
  "back_extra_2",
  "detail_extra",
  "detail_extra_2",
] as const;
export type GarmentSlot = (typeof GARMENT_SLOTS)[number];

// Full-resolution crops of a complex print, marked by the user on a garment photo (two per view).
export const PATTERN_SLOTS = [
  "pattern_front",
  "pattern_front_2",
  "pattern_back",
  "pattern_back_2",
  "pattern_detail",
  "pattern_detail_2",
] as const;
export type PatternSlot = (typeof PATTERN_SLOTS)[number];

// services/patternReference.js
export const MAX_SWATCHES = 3;

// ---------- productGeneration.js ----------

export const GARMENT_SLOT_LABEL: Record<string, string> = {
  front: "front",
  back: "back",
  detail: "detail / close-up",
  front_extra: "extra front",
  front_extra_2: "extra front 2",
  back_extra: "extra back",
  back_extra_2: "extra back 2",
  detail_extra: "extra detail",
  detail_extra_2: "extra detail 2",
};

export const GARMENT_EXTRAS_BY_ROLE: Record<"front" | "back" | "detail", string[]> = {
  front: ["front_extra", "front_extra_2"],
  back: ["back_extra", "back_extra_2"],
  detail: ["detail_extra", "detail_extra_2"],
};

export const EXTRA_GARMENT_RANK = new Map<string, number>(
  Object.values(GARMENT_EXTRAS_BY_ROLE).flatMap((slots, view) =>
    slots.map((slot, depth) => [slot, depth * 10 + view] as [string, number]),
  ),
);

export const PAIRING_FOOTWEAR_LABEL = {
  pairing: "pairing item",
  footwear: "footwear",
};

// Pose send as prompt
export const POSE_AS_IMAGE = false;

// ---------- promptVariables.js ----------

export const variablePattern = () => /\{\{[ \t]*([a-z0-9_]+)[ \t]*\}\}/gi;

// ---------- shotPromptTemplates.js ----------

export const GARMENT_SLOT_GROUPS: Record<"front" | "back" | "detail", string[]> = {
  front: ["front", "front_extra", "front_extra_2"],
  back: ["back", "back_extra", "back_extra_2"],
  detail: ["detail", "detail_extra", "detail_extra_2"],
};

export const PRIMARY_SOURCE_ROLES = Object.keys(GARMENT_SLOT_GROUPS) as ("front" | "back" | "detail")[];

export const GARMENT_INPUT_PRIMARY_ROLES: Record<OriginalShotType, ("front" | "back" | "detail")[]> = {
  initial: ["front", "detail"],
  front: ["front", "detail"],
  front_full_sleeve: ["front", "detail"],
  mood: ["front", "detail"],
  side: ["front", "detail"],
  closeup: ["front", "detail"],
  closeup_front: ["front", "detail"],
  closeup_dynamic_front: ["front", "detail"],
  lifestyle: ["front", "detail"],
  dynamic_lifestyle: ["front", "detail"],
  back: ["back"],
  closeup_back: ["back", "detail"],
  closeup_dynamic_back: ["back", "detail"],
};

export function expandPrimarySourceMapping(
  primaries: string[],
  { detailExtraLimit = 1 }: { detailExtraLimit?: number | null } = {},
): string[] {
  const out: string[] = [];
  for (const primary of primaries) {
    const group = GARMENT_SLOT_GROUPS[primary as keyof typeof GARMENT_SLOT_GROUPS];
    if (!group) continue;
    out.push(group[0]);
    const extras = group.slice(1);
    out.push(...(primary === "detail" && detailExtraLimit != null ? extras.slice(0, detailExtraLimit) : extras));
  }
  return out;
}

// null means "don't narrow" (no placeholders, or the generic {{garment_image}} which can mean any slot).
export function promptGarmentSlots(promptTemplate: string | null | undefined): Set<string> | null {
  const text = String(promptTemplate ?? "");
  if (!text.includes("{{")) return null;
  const names = new Set<string>();
  for (const [, name] of text.matchAll(variablePattern())) names.add(name.toLowerCase());
  if (names.has("garment_image")) return null;
  const wanted = new Set<string>();
  if (names.has("front_image")) wanted.add("front");
  if (names.has("back_image")) wanted.add("back");
  if (names.has("detail_image")) wanted.add("detail");
  return wanted;
}

export type PromptShot = {
  shotType: OriginalShotType;
  isInitialLook: boolean;
  promptTemplate: string;
  inheritInitialLookBackground: boolean;
};

function fallbackRoles(shot: PromptShot): string[] {
  const type = shot?.shotType ?? "front";
  return expandPrimarySourceMapping(GARMENT_INPUT_PRIMARY_ROLES[type] ?? GARMENT_INPUT_PRIMARY_ROLES.front, {
    detailExtraLimit: 2,
  });
}

export function garmentPrimaryRolesForShot(shot: PromptShot): string[] {
  if (shot?.isInitialLook) {
    return expandPrimarySourceMapping(GARMENT_INPUT_PRIMARY_ROLES.initial, { detailExtraLimit: 2 });
  }

  const wanted = promptGarmentSlots(shot?.promptTemplate);
  if (wanted && wanted.size) {
    return expandPrimarySourceMapping(
      PRIMARY_SOURCE_ROLES.filter((role) => wanted.has(role)),
      { detailExtraLimit: 2 },
    );
  }

  return fallbackRoles(shot);
}

// productGeneration.js:300
export function continuityGarmentSlots(shot: PromptShot): string[] {
  const roles = garmentPrimaryRolesForShot(shot);
  const hasFront = roles.some((role) => role === "front" || role.startsWith("front_"));
  const hasBack = roles.some((role) => role === "back" || role.startsWith("back_"));
  if (hasBack && !hasFront) {
    return roles.filter(
      (role) => role === "back" || role.startsWith("back_") || role === "detail" || role.startsWith("detail_"),
    );
  }
  return roles;
}

// productGeneration.js:316
export function garmentRolesForShot(shot: PromptShot, { continuity = false } = {}): string[] {
  const roles = continuity ? continuityGarmentSlots(shot) : garmentPrimaryRolesForShot(shot);
  if (continuity && roles.length === 0) return [];
  return roles;
}

// productGeneration.js:322 — the upload slots a shot can't run without
export function requiredGarmentSlots(shot: PromptShot): ("front" | "back" | "detail")[] {
  const roles = garmentPrimaryRolesForShot(shot);
  if (shot.isInitialLook) {
    if (roles.some((role) => role === "front" || role.startsWith("front_"))) return ["front"];
    const primary = roles.find((role) => role === "front" || role === "back" || role === "detail");
    return primary ? [primary as "front" | "back" | "detail"] : ["front"];
  }
  const needed = new Set<string>();
  for (const role of roles) {
    if (role === "front" || role.startsWith("front_")) needed.add("front");
    else if (role === "back" || role.startsWith("back_")) needed.add("back");
    else if (role === "detail" || role.startsWith("detail_")) needed.add("detail");
  }
  return (["front", "back", "detail"] as const).filter((role) => needed.has(role));
}

// ---------- dynamicShots.js ----------

/** Shots that invent pose + background at generation time — no pose/background library. */
export const DYNAMIC_SHOT_TYPES = new Set<string>(["closeup_dynamic_front", "closeup_dynamic_back", "dynamic_lifestyle"]);

export function isDynamicShot(shotType: string): boolean {
  return DYNAMIC_SHOT_TYPES.has(shotType);
}

export function isCatalogCloseupShot(shotType: string): boolean {
  return shotType === "closeup" || shotType === "closeup_front" || shotType === "closeup_back";
}

/** Dynamic detail shots: invent pose/camera, but keep the studio plate. */
export function isDynamicCloseupShot(shotType: string): boolean {
  return shotType === "closeup_dynamic_front" || shotType === "closeup_dynamic_back";
}

/** Only dynamic_lifestyle invents a new environment; dynamic closeups stay on studio. */
export function inventsBackground(shotType: string): boolean {
  return shotType === "dynamic_lifestyle";
}

// ---------- catalogReferenceQuality.js ----------

const REFERENCE_CORE = [
  "REFERENCE OUTPUT QUALITY (premium ethnic catalog benchmark — hard constraint):",
  "Match high-end fashion studio lookbook quality — crisp, smooth, professionally styled.",
  "SHARPNESS: Clean tack-sharp focus on model and {{garment_image}} — embroidery, fabric sheen, and hair all readable. Smooth photograph — zero grain, zero noise, zero oversharpening halos.",
  "PRINT/PATTERN: Replicate the garment print, pattern, embroidery, and borders exactly from the product photos — same motifs, motif scale, spacing, density, placement, and colors. Do not simplify, redraw, invent, or substitute a similar-looking pattern.",
  "GARMENT DETAILS: every zipper, logo, badge, patch, label, button, buckle, drawstring, piping, and trim must match the product photos exactly — same position, size, shape, color, finish (metal/plastic/fabric), and logo artwork/text. Do not add, remove, move, mirror, recolor, or redraw any of them.",
  "COLOR: Exact {{garment_image}} garment hue and saturation on EVERY shot — no warm cast, sunlight tint, jewel-shift, or orange/yellow lift on garment or backdrop. Same catalog color grade across the pack (no per-shot regrade). Do NOT recolor or lighten skin to satisfy white-balance — keep the model face photo's exact melanin depth and warm olive undertone. No oversaturation, no boosted vibrancy, no punchy commercial grade. The studio light must never shift the garment's own color — garment hue stays exactly as in the product photo.",
  "LIGHTING: Neutral even studio light (~5200–5600K daylight) with soft fill that does NOT lift darker skin midtones toward fair. Same recipe on every studio shot. Do NOT add golden hour or sunlight shafts. Warmth already in the model's skin undertone must stay.",
  "FABRIC: Freshly steamed and pressed — smooth kurta/kameez panels, crisp hems, subtle natural lustre on folds. NOT crushed, NOT rumpled, NOT matte-dead. Dupatta only if already on {{garment_image}} / Initial Look.",
  "DEPTH: Subject sharp; background slightly softer — garment pops forward as hero.",
  "SKIN: Natural dry-to-satin catalog finish — visible pores/texture, soft shadow under chin for depth. Only a faint forehead/nose specular if any. FORBIDDEN: dewy, glass skin, oily cheek glow, wet highlighter, soft-glam sheen, or plastic airbrush. SKIN DEPTH LOCK: match face-reference melanin depth exactly on face/neck/hands — dusky/dark stays dusky/dark with the same warm olive undertone (never fairer, porcelain, or blown-highlight bleach). Same skin tone + makeup intensity on every shot in the pack.",
  "HEIGHT: Same tall adult proportions on every full-length shot — do not shrink or restock the model between angles.",
].join("\n");

const SHOT_REFERENCE: Record<string, string[]> = {
  front: [
    "FRONT SHOT BENCHMARK: Full-length studio portrait head-to-toe — exact {{garment_image}} garment color, complete outfit uncropped, pressed fabric, sharp embroidery, confident catalog pose. Neutral studio light only.",
  ],
  front_full_sleeve: [
    "FRONT SHOT BENCHMARK: Full-length studio portrait head-to-toe — exact {{garment_image}} garment color, complete outfit uncropped, pressed fabric, sharp embroidery, confident catalog pose. Neutral studio light only.",
  ],
  side: [
    "SIDE SHOT BENCHMARK: Full-length side-profile studio portrait — exact {{garment_image}} garment color, silhouette and drape clearly readable from the side, pressed fabric, sharp embroidery. Neutral studio light only, SAME as front.",
  ],
  back: [
    "BACK SHOT BENCHMARK: Full-length true rear view — back panel and hem equally sharp and pressed as front; true {{garment_image}} color; SAME neutral studio light as front (no warmer cast). Face away / not readable unless a tiny over-shoulder glance; any visible face slice must match Initial Look identity, never a different person.",
  ],
  closeup: [
    "CLOSE-UP BENCHMARK: Extreme telephoto garment detail — collarbone to hem fills 85%+ of frame. Macro-clean embroidery, neckline, border, and fabric texture. NO full body, NO feet, NO floor. Soft background; SAME neutral studio light — no warm side light.",
  ],
  detail: [
    "DETAIL BENCHMARK: Tight fabric/embroidery crop — every stitch and border motif crisp, smooth pressed surface, SAME neutral studio light as other shots.",
  ],
  lifestyle: [
    "LIFESTYLE BENCHMARK: Editorial campaign quality — same height/makeup/skin tone/garment color as Initial Look (never shortened or regraded), even location light matching the plate (no added warm hue or sunlight shafts), natural dry-to-satin skin (not dewy), garment hero-sharp with exact {{garment_image}} hue and saturation (not brighter, not more vivid), clean and noise-free.",
  ],
  mood: [
    "MOOD BENCHMARK: Dramatic dark-studio editorial quality — deliberate harsh shadow/highlight and rim light per the shot's own lighting direction, garment still hero-sharp with exact {{garment_image}} color, clean and noise-free despite the low-key look.",
  ],
};

/** Initial look uses the full look-shot benchmark. */
const LOOK_REFERENCE = [
  "LOOK SHOT BENCHMARK: Full editorial initial-look quality — complete outfit head-to-toe with margin, tall adult catalog proportions (long legs, normal head size — never short/stocky/large-head), exact {{garment_image}} garment color, NEUTRAL daylight studio light (~5200–5600K, no warm hue/yellow/orange/sunlight), pressed fabric, sharp embroidery, natural dry-to-satin skin (not dewy). No extra dupatta/stole unless already on the product.",
];

export function referenceOutputQuality(
  shotType: string,
  { isInitialLook = false, dynamic = false }: { isInitialLook?: boolean; dynamic?: boolean } = {},
): string {
  const parts = [REFERENCE_CORE];
  if (isInitialLook) {
    parts.push(...LOOK_REFERENCE);
    return parts.join("\n");
  }
  if (dynamic && shotType === "dynamic_lifestyle") {
    parts.push(...(SHOT_REFERENCE.lifestyle ?? []));
    return parts.join("\n");
  }
  if (dynamic) {
    parts.push(
      "DYNAMIC SHOT BENCHMARK: Top model editorial catalog quality — confident fluid pose, sharp garment, exact {{garment_image}} color, smooth noise-free finish, pressed fabric. Neutral light only — no warm hue or sunlight.",
    );
    return parts.join("\n");
  }
  const isPlainCloseup = shotType === "closeup" || shotType === "closeup_front" || shotType === "closeup_back";
  const key = isPlainCloseup ? "closeup" : shotType;
  const extra = SHOT_REFERENCE[key];
  if (extra?.length) parts.push(...extra);
  return parts.join("\n");
}

// --------------------------------------------------
// CATALOGUE: prompt builder (pure, no I/O)
//
// Word-for-word port of ai-catalog-backend's legacy engine
// (src/services/productGeneration.js buildPrompt and its
// reference pipeline). One call = one shot:
//   1. pick this shot's images (collectReferences)
//   2. order and trim them to the model's cap
//      (packReferencesToCap / referencesForModel)
//   3. build the block prompt against those @imgN tags
//      (buildPrompt + bindReferencePlaceholders)
//   4. our CORRECTION block (feedback), then OUTPUT_SHARPNESS
// The parts live in ./prompt/*.
// --------------------------------------------------

import type { ShotType } from "./shared";
import { buildPrompt } from "./prompt/blocks";
import {
  ORIGINAL_SHOT_TYPES,
  OUTPUT_SHARPNESS,
  isCatalogCloseupShot,
  isDynamicCloseupShot,
  requiredGarmentSlots,
  withOutputSharpness,
  type OriginalShotType,
  type PromptShot,
} from "./prompt/constants";
import { collectReferences, packReferencesToCap, uploadItemLabel } from "./prompt/references";
import type { OrigRef, PromptContext, Reference } from "./prompt/types";
import { applyFraming, frameShotText, framingApplies } from "./prompt/framing";

export type { PromptContext, RefRole, Reference, SkinDepthNote } from "./prompt/types";
export { ORIGINAL_SHOT_TYPES, OUTPUT_SHARPNESS, type OriginalShotType } from "./prompt/constants";

// The AI service's prompt limit (no budget otherwise: the
// original has none)
export const PROMPT_MAX_CHARS = 32000;

// Ours: the original rewrites the prompt with refinePrompt
// (a text model); until then feedback is appended.
export const CORRECTION_HEADING = "CORRECTION FROM REVIEWER (apply, change nothing else):";

// ---------- Shot types ----------

const SHOT_TYPE_MAP: Record<ShotType, OriginalShotType> = {
  initial: "initial",
  front: "front",
  back: "back",
  side: "side",
  closeup: "closeup",
  detail: "closeup",
  lifestyle: "lifestyle",
  full: "front",
};

export function originalShotType(ctx: Pick<PromptContext, "shot" | "shotType">): OriginalShotType {
  if (ctx.shotType && (ORIGINAL_SHOT_TYPES as readonly string[]).includes(ctx.shotType)) return ctx.shotType;
  return SHOT_TYPE_MAP[ctx.shot.type] ?? "front";
}

// Our {{product}} / {{category}} / {{gender}} (not in the
// original); the image variables are left for the original's
// resolveTemplateVariables / bindReferencePlaceholders.
function fillOurVars(text: string, ctx: PromptContext): string {
  const values: Record<string, string> = {
    product: ctx.product.name,
    category: ctx.product.category,
    gender: ctx.product.gender,
  };
  return text.replace(/\{\{[ \t]*([a-z0-9_]+)[ \t]*\}\}/gi, (match, name: string) => values[name.toLowerCase()] ?? match);
}

function promptShot(ctx: PromptContext): PromptShot {
  const text = fillOurVars(ctx.shot.prompt ?? "", ctx);
  return {
    shotType: originalShotType(ctx),
    isInitialLook: ctx.isInitial,
    promptTemplate: framingApplies(ctx.framing, ctx.shot.type) ? frameShotText(text, ctx.framing) : text,
    inheritInitialLookBackground: ctx.inheritBackground !== false,
  };
}

// The garment uploads this shot can't run without
// (requiredGarmentSlots), as our roles
export function missingGarmentRoles(ctx: PromptContext): Reference["role"][] {
  const roleOf = { front: "garment_front", back: "garment_back", detail: "garment_detail" } as const;
  return requiredGarmentSlots(promptShot(ctx))
    .map((slot) => roleOf[slot])
    .filter((role) => !ctx.references.some((r) => r.role === role && r.url));
}

// ---------- References ----------

function packed(ctx: PromptContext, shot: PromptShot): { refs: OrigRef[]; continuity: boolean } {
  const { refs, continuity } = collectReferences(ctx, shot);
  const prioritizeBackground =
    continuity && (isCatalogCloseupShot(shot.shotType) || isDynamicCloseupShot(shot.shotType));
  return {
    continuity,
    refs: packReferencesToCap(refs, ctx.maxRefs, {
      prioritizeBackground,
      outfitComposite: ctx.stylingComposites?.outfit,
    }),
  };
}

// The images sent, in @img order
export function pickReferences(ctx: PromptContext): Reference[] {
  return packed(ctx, promptShot(ctx)).refs.map(outRef);
}

function outRef(ref: OrigRef): Reference {
  if (ref.url === ref.source.url) return ref.source;
  // Face crop / composites: a new URL for the same job
  return { ...ref.source, url: ref.url, ...(ref.label ? { label: ref.label } : {}) };
}

// ---------- Build ----------

function clipTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.9 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function buildShotRequest(ctx: PromptContext): { prompt: string; references: string[]; sent: Reference[] } {
  const shot = promptShot(ctx);
  const { refs, continuity } = packed(ctx, shot);
  const fill = (text: string | null | undefined) => (text?.trim() ? fillOurVars(text, ctx) : "");

  const modelAppearanceNotes =
    ctx.modelDescription !== undefined
      ? fill(ctx.modelDescription)
      : [fill(ctx.model?.prompt), fill(ctx.styling)].filter(Boolean).join("\n");

  const ported = buildPrompt(shot, {
    pose: ctx.pose
      ? {
          prompt: fill(ctx.pose.prompt),
          wearStyleNotes: fill(ctx.poseWearStyleNotes) || null,
          productCategories: ctx.poseProductCategories ?? [],
        }
      : null,
    background: ctx.background
      ? { prompt: fill(ctx.background.prompt), backgroundType: ctx.background.setting }
      : null,
    notes: fill(ctx.product.notes),
    modelAppearanceNotes: modelAppearanceNotes || null,
    isInitial: ctx.isInitial,
    hasInitialLook: continuity,
    categoryName: ctx.product.category,
    product: {
      categoryId: ctx.productCategoryId ?? null,
      hasPairing: ctx.references.some((r) => r.role === "pairing" && r.url),
      hasFootwear: ctx.references.some((r) => r.role === "footwear" && r.url),
      uploadedAccessories: ctx.references
        .filter((r) => r.role === "accessory" && r.uploaded && r.url)
        .map((r) => uploadItemLabel("accessories", r.label)),
    },
    model: ctx.model ? { wearStyleNotes: fill(ctx.model.notes) || null } : null,
    references: refs,
    accessories: ctx.accessories.map((a) => ({ name: a.name })),
    skinDepthNote: ctx.skinDepth ?? null,
  });
  // Upper / lower body: the full-length lines follow the framing
  const body = framingApplies(ctx.framing, ctx.shot.type)
    ? applyFraming(ported, ctx.framing, ctx.product.name)
    : ported;

  const feedback = ctx.feedback.trim();
  const correction = feedback ? `${CORRECTION_HEADING}\n${clipTo(feedback, 4000)}` : "";
  const tail = [correction, OUTPUT_SHARPNESS].filter(Boolean).join("\n\n");
  // Hard safety cap only (the AI service's limit)
  const room = PROMPT_MAX_CHARS - tail.length - 2;
  const prompt = withOutputSharpness([clipTo(body, room), correction].filter(Boolean).join("\n\n"));

  const sent = refs.map(outRef);
  return { prompt, references: sent.map((r) => r.url), sent };
}

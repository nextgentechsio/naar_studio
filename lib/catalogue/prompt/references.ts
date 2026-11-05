// --------------------------------------------------
// CATALOGUE: which reference images a shot sends, in what
// order (@img1, @img2…), trimmed to the model's cap.
//
// Pure port of productGeneration.js collectReferences
// (≈2060), buildPairingFootwearReferences (1769),
// buildAccessoryReferences (1804), patternReferences
// (services/patternReference.js), rankReferences (1885),
// packReferencesToCap (1934), orderReferencesForImgTags
// (1980) and referencesForModel (2016).
// --------------------------------------------------

import {
  EXTRA_GARMENT_RANK,
  MAX_SWATCHES,
  PAIRING_FOOTWEAR_LABEL,
  PATTERN_SLOTS,
  POSE_AS_IMAGE,
  garmentRolesForShot,
  type PromptShot,
} from "./constants";
import type { OrigRef, OrigRole, PromptContext, Reference } from "./types";

// ---------- Mapping our roles onto the original's ----------

const GARMENT_SLOT_OF: Partial<Record<Reference["role"], string>> = {
  garment_front: "front",
  garment_back: "back",
  garment_detail: "detail",
};

export function toOrigRef(ref: Reference): OrigRef | null {
  if (!ref?.url) return null;
  const base = { url: ref.url, source: ref };
  switch (ref.role) {
    case "garment_front":
    case "garment_back":
    case "garment_detail":
      return { ...base, role: "garment", slot: GARMENT_SLOT_OF[ref.role] };
    case "garment_extra":
      return { ...base, role: "garment", slot: ref.slot && EXTRA_GARMENT_RANK.has(ref.slot) ? ref.slot : "front_extra" };
    case "model_face":
      return { ...base, role: "model" };
    case "initial_look":
      return { ...base, role: "initial" };
    case "pose":
      return { ...base, role: "pose" };
    case "background":
      return { ...base, role: "background" };
    case "pairing":
      return { ...base, role: "pairing", label: uploadItemLabel("pairing", ref.label) };
    case "footwear":
      return { ...base, role: "footwear", label: uploadItemLabel("footwear", ref.label) };
    case "accessory":
      return {
        ...base,
        role: "accessories",
        label: ref.uploaded ? uploadItemLabel("accessories", ref.label) : ref.label?.trim() || "accessory",
      };
    case "pattern":
      return { ...base, role: "pattern", slot: ref.slot };
    case "reference":
      return { ...base, role: "reference", label: ref.label };
    case "previous":
      return { ...base, role: "previous" };
    case "styling":
      return { ...base, role: "styling", label: ref.label };
  }
}

/** "pairing: inner t-shirt" — keeps the role word so {{pairing_image}} still finds composites. */
export function uploadItemLabel(slot: string, inputLabel?: string | null): string {
  const kind = slot.startsWith("pairing")
    ? PAIRING_FOOTWEAR_LABEL.pairing
    : slot.startsWith("accessories")
      ? "accessory"
      : PAIRING_FOOTWEAR_LABEL[slot as keyof typeof PAIRING_FOOTWEAR_LABEL] || slot;
  const label = String(inputLabel ?? "").trim();
  return label ? `${kind}: ${label}` : kind;
}

export function isExtraGarmentAngle(ref: OrigRef | null | undefined): boolean {
  return ref?.role === "garment" && EXTRA_GARMENT_RANK.has(String(ref.slot));
}

// ---------- Template variables (promptVariables.js) ----------

type Predicate = (r: OrigRef | null | undefined) => boolean;

export const TEMPLATE_VARIABLES: Record<string, Predicate> = Object.assign(Object.create(null) as Record<string, Predicate>, {
  garment_image: (r: OrigRef | null | undefined) => r?.role === "garment",
  front_image: (r: OrigRef | null | undefined) => r?.role === "garment" && r?.slot === "front",
  back_image: (r: OrigRef | null | undefined) => r?.role === "garment" && r?.slot === "back",
  detail_image: (r: OrigRef | null | undefined) => r?.role === "garment" && r?.slot === "detail",
  model_image: (r: OrigRef | null | undefined) => r?.role === "model",
  initial_look: (r: OrigRef | null | undefined) => r?.role === "initial",
  pose_image: (r: OrigRef | null | undefined) => r?.role === "pose",
  background: (r: OrigRef | null | undefined) => r?.role === "background",
  pairing_image: (r: OrigRef | null | undefined) =>
    r?.role === "pairing" || (r?.role === "styling" && /pairing/i.test(String(r.label || ""))),
  footwear_image: (r: OrigRef | null | undefined) =>
    r?.role === "footwear" || (r?.role === "styling" && /footwear/i.test(String(r.label || ""))),
  accessories_image: (r: OrigRef | null | undefined) =>
    r?.role === "accessories" || (r?.role === "styling" && /accessor/i.test(String(r.label || ""))),
});

export const TEMPLATE_VARIABLE_NAMES = Object.keys(TEMPLATE_VARIABLES);

export function imgTag(references: OrigRef[], predicate: Predicate): string | null {
  const i = (Array.isArray(references) ? references : []).findIndex(predicate);
  return i >= 0 ? `@img${i + 1}` : null;
}

// ---------- Selection (collectReferences) ----------

// Pattern swatches marked on the views this shot sends:
// first swatch of each view before any second one.
function patternReferences(all: OrigRef[], views: Set<string>): OrigRef[] {
  const viewOf = (slot: string) => slot.split("_")[1];
  const bySlot = new Map<string, OrigRef>();
  for (const ref of all) if (ref.role === "pattern" && ref.slot && !bySlot.has(ref.slot)) bySlot.set(ref.slot, ref);
  const marked = PATTERN_SLOTS.filter((slot) => bySlot.has(slot) && views.has(viewOf(slot)));
  const prioritized = [...marked.filter((slot) => !slot.endsWith("_2")), ...marked.filter((slot) => slot.endsWith("_2"))];
  return prioritized
    .slice(0, MAX_SWATCHES)
    .map((slot) => ({ ...bySlot.get(slot)!, label: `${viewOf(slot)} print` }));
}

function buildPairingFootwearReferences(all: OrigRef[], composite: string | null | undefined): OrigRef[] {
  const present = [...all.filter((r) => r.role === "pairing"), ...all.filter((r) => r.role === "footwear").slice(0, 1)];
  if (present.length <= 1 || !composite) return present;
  const label = present.map((r) => r.label).join(", ");
  return [{ role: "styling", url: composite, label, source: { role: "styling", url: composite, label } }];
}

// Catalog accessories (picker) + uploaded accessories → one reference image
function buildAccessoryReferences(all: OrigRef[], composite: string | null | undefined): OrigRef[] {
  const accessories = all.filter((r) => r.role === "accessories");
  const present = [...accessories.filter((r) => !r.source.uploaded), ...accessories.filter((r) => r.source.uploaded)];
  if (present.length <= 1 || !composite) return present;
  const label = present.map((r) => r.label).join(", ");
  return [{ role: "accessories", url: composite, label, source: { role: "accessory", url: composite, label } }];
}

export type Selection = {
  // Continuity shot: an Initial Look is sent
  continuity: boolean;
  refs: OrigRef[];
};

export function collectReferences(ctx: PromptContext, shot: PromptShot): Selection {
  const all = ctx.references.map(toOrigRef).filter((r): r is OrigRef => r !== null);
  const first = (role: OrigRole) => all.find((r) => r.role === role) ?? null;
  const initialLook = ctx.isInitial ? null : first("initial");
  const hasInitialContinuity = Boolean(initialLook);
  const fullInputRefs = Boolean(ctx.regenerate);
  const slimGarments = hasInitialContinuity && !fullInputRefs;

  const garmentBySlot = new Map<string, OrigRef>();
  for (const ref of all) if (ref.role === "garment" && ref.slot && !garmentBySlot.has(ref.slot)) garmentBySlot.set(ref.slot, ref);
  const garments: OrigRef[] = [];
  for (const slot of garmentRolesForShot(shot, { continuity: slimGarments })) {
    const ref = garmentBySlot.get(slot);
    if (ref) garments.push(ref);
  }
  // Deviation: the original requires every view at upload
  // (front + back), so a shot always finds its views. Ours
  // only requires the front: never send no garment at all.
  if (!garments.length && garmentBySlot.size) {
    garments.push(garmentBySlot.get("front") ?? [...garmentBySlot.values()][0]);
  }
  // Only the swatches marked on the views this shot actually uses (front shot → front prints, etc.).
  const views = new Set(garments.map((g) => String(g.slot).split("_")[0]));
  garments.push(...patternReferences(all, views));

  let modelRef: OrigRef | null = null;
  const model = !hasInitialContinuity ? first("model") : null;
  if (model) {
    modelRef = ctx.faceCropUrl
      ? { ...model, url: ctx.faceCropUrl, label: "face_identity_crop" }
      : { ...model, label: "face_identity" };
  }

  const backgroundRef = first("background");
  const initialRef = initialLook;
  const poseRef = (ctx.poseAsImage ?? POSE_AS_IMAGE) ? first("pose") : null;

  const isLifestyleShot = shot.shotType === "lifestyle" || shot.shotType === "dynamic_lifestyle";
  let stylingRefs: OrigRef[] = [];
  if (!hasInitialContinuity || fullInputRefs || isLifestyleShot) {
    stylingRefs = buildPairingFootwearReferences(all, ctx.stylingComposites?.pairingFootwear);
  }

  const extraRef = first("reference");
  // Ours: the attempt being corrected, only with feedback
  const previousRef = ctx.feedback.trim() ? first("previous") : null;

  let accessoryRefs: OrigRef[] = [];
  if (!hasInitialContinuity || fullInputRefs) {
    accessoryRefs = buildAccessoryReferences(all, ctx.stylingComposites?.accessories);
  }

  // rankReferences
  const ranked = [
    ...garments,
    ...stylingRefs,
    ...(extraRef ? [extraRef] : []),
    ...(previousRef ? [previousRef] : []),
    ...accessoryRefs,
    ...(backgroundRef ? [backgroundRef] : []),
    ...(modelRef ? [modelRef] : []),
    ...(initialRef ? [initialRef] : []),
    ...(poseRef ? [poseRef] : []),
  ];

  const seen = new Set<string>();
  const kept: OrigRef[] = [];
  for (const ref of ranked) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    kept.push(ref);
  }
  return { continuity: hasInitialContinuity, refs: kept };
}

// ---------- Order, rank, pack ----------

export function orderReferencesForImgTags(references: OrigRef[]): OrigRef[] {
  const list = Array.isArray(references) ? references : [];
  const garments = list.filter((r) => r?.role === "garment");
  const initial = list.find((r) => r?.role === "initial");
  const model = list.find((r) => r?.role === "model");
  const pose = list.find((r) => r?.role === "pose");
  const background = list.find((r) => r?.role === "background");
  const other = list.filter(
    (r) =>
      r &&
      r.role !== "garment" &&
      r.role !== "model" &&
      r.role !== "initial" &&
      r.role !== "pose" &&
      r.role !== "background",
  );
  const primary = garments.find((g) => !isExtraGarmentAngle(g)) ?? garments[0];
  const rest = garments.filter((g) => g !== primary);
  const views = rest.filter((g) => !isExtraGarmentAngle(g));
  const extras = rest
    .filter(isExtraGarmentAngle)
    .sort((a, b) => EXTRA_GARMENT_RANK.get(String(a.slot))! - EXTRA_GARMENT_RANK.get(String(b.slot))!);
  const out: OrigRef[] = [];
  // Model face anchors identity first, but the garment comes right after it — not buried
  // behind Initial Look too.
  if (model) out.push(model);
  if (primary) out.push(primary);
  if (initial) out.push(initial);
  if (pose) out.push(pose);
  out.push(...views, ...other, ...extras);
  if (background) out.push(background);
  return out;
}

export function referencesForModel(
  references: OrigRef[],
  cap: number,
  { prioritizeBackground = false }: { prioritizeBackground?: boolean } = {},
): OrigRef[] {
  const list = Array.isArray(references) ? references : [];
  const ordered = orderReferencesForImgTags(list);

  if (ordered.length <= cap) return ordered;

  const initial = ordered.find((r) => r?.role === "initial");
  const modelFace = ordered.find((r) => r?.role === "model");
  const primaryGarment =
    ordered.find((r) => r?.role === "garment" && !isExtraGarmentAngle(r)) || ordered.find((r) => r?.role === "garment");
  const rank = (ref: OrigRef) => {
    if (ref === modelFace) return 0;
    if (ref === initial) return 0.25;
    if (ref?.role === "model" || ref?.role === "initial") return 0.3;
    if (ref === primaryGarment) return 1;
    if (ref.role === "pattern") return 1.2;
    if (ref.role === "pose") return 2;
    // Ours: `previous` ranks like the original's `reference`
    if (ref.role === "reference" || ref.role === "previous") return 1.5;
    if (ref.role === "background") return prioritizeBackground ? 2.5 : 4;
    if (ref.role === "garment" && !isExtraGarmentAngle(ref)) return 3;
    // Keep clubbed/individual styling ahead of secondary garment angles.
    if (ref.role === "styling") return 3.5;
    if (ref.role === "pairing") return 3.5;
    if (ref.role === "footwear") return 3.5;
    if (ref.role === "accessories") return 3.5;
    if (isExtraGarmentAngle(ref)) return String(ref.slot).startsWith("detail") ? 3.2 : 7;
    if (ref.role === "garment") return 5;
    return 6;
  };
  const kept = ordered
    .map((ref, index) => ({ ref, index, rank: rank(ref) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, cap))
    .map((entry) => entry.ref);
  return orderReferencesForImgTags(kept);
}

const STYLING_PACK_ROLES = new Set<OrigRole>(["pairing", "footwear", "accessories", "styling"]);

function isStylingPackRef(ref: OrigRef | null | undefined): boolean {
  return Boolean(ref && STYLING_PACK_ROLES.has(ref.role));
}

export function stylingPackLabel(refs: OrigRef[]): string {
  const labels: string[] = [];
  for (const ref of refs) {
    if (ref.role === "pairing") labels.push(ref.label || PAIRING_FOOTWEAR_LABEL.pairing);
    else if (ref.role === "footwear") labels.push(PAIRING_FOOTWEAR_LABEL.footwear);
    else if (ref.role === "accessories") labels.push(ref.label || "accessories");
    else if (ref.role === "styling" && ref.label) {
      for (const part of String(ref.label).split(",")) {
        const trimmed = part.trim();
        if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
      }
    }
  }
  return labels.join(", ") || "outfit styling";
}

/**
 * When refs exceed the model cap, club pairing + footwear + accessories into one
 * composite before dropping anything (only when that composite was made: ctx
 * stylingComposites.outfit). Then rank-based trimming.
 */
export function packReferencesToCap(
  references: OrigRef[],
  cap: number,
  opts: { prioritizeBackground?: boolean; outfitComposite?: string | null } = {},
): OrigRef[] {
  let packed = Array.isArray(references) ? [...references] : [];
  if (packed.length <= cap) return referencesForModel(packed, cap, opts);

  const stylingRefs = packed.filter(isStylingPackRef);
  if (stylingRefs.length >= 2 && opts.outfitComposite) {
    const label = stylingPackLabel(stylingRefs);
    const merged: OrigRef = {
      role: "styling",
      url: opts.outfitComposite,
      label,
      source: { role: "styling", url: opts.outfitComposite, label },
    };
    packed = [...packed.filter((r) => !isStylingPackRef(r)), merged];
  }

  return referencesForModel(packed, cap, opts);
}

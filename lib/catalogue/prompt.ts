// --------------------------------------------------
// CATALOGUE: prompt builder (pure, no I/O)
//
// Port of ai-catalog-backend's buildPrompt and its
// reference packing (rankReferences / packReferencesToCap
// / referencesForModel). One call = one shot: pick and
// order the images to send, number them, give each one
// job, then the block prompt.
// --------------------------------------------------

import type { Gender, PublicAsset, ShotDefinition, ShotType } from "./shared";

export type RefRole =
  | "garment_front"
  | "garment_back"
  | "garment_detail"
  | "garment_extra"
  | "pairing"
  | "footwear"
  | "model_face"
  | "background"
  | "accessory"
  | "initial_look"
  | "previous";

export type Reference = { role: RefRole; url: string; label?: string };

export type PromptContext = {
  shot: ShotDefinition;
  isInitial: boolean;
  product: { name: string; category: string; gender: Gender; notes: string };
  styling: string;
  model: PublicAsset | null;
  pose: PublicAsset | null;
  background: PublicAsset | null;
  accessories: PublicAsset[];
  feedback: string;
  references: Reference[];
  maxRefs: number;
};

// Target size; optional blocks drop first, then text is clipped
export const PROMPT_TARGET = 6000;

// Appended to every prompt (src/constants/outputSharpness.js)
export const OUTPUT_SHARPNESS =
  "OUTPUT QUALITY: render as an ultra-high-resolution 8K-quality photograph — tack-sharp focus, crisp fabric texture, weave, print and stitching, clean edges, fine hair and skin detail. No blur, no softness, no haze, no smudged or smeared print, no noise, no compression artifacts, no upscaling halos.";

export const CORRECTION_HEADING = "CORRECTION FROM REVIEWER (apply, change nothing else):";

// ---------- References ----------

const FULL_LENGTH: ShotType[] = ["initial", "front", "back", "side", "full", "lifestyle"];
const CLOSE: ShotType[] = ["closeup", "detail"];

// Lower = more important. null = not sent for this shot.
// Garment front is always first; for later shots the
// initial look comes next (continuity), then the face.
function rank(ref: Reference, ctx: PromptContext): number | null {
  const { shot, isInitial } = ctx;
  const lifestyle = isLifestyle(ctx);
  switch (ref.role) {
    case "garment_front":
      return 0;
    case "initial_look":
      return isInitial ? null : 1;
    case "model_face":
      return 2;
    case "garment_back":
      return shot.type === "back" ? 1.5 : 4;
    case "garment_detail":
      return CLOSE.includes(shot.type) ? 1.5 : 4.5;
    // Only useful when there's a correction to apply to it
    case "previous":
      return ctx.feedback.trim() ? 3 : null;
    case "background":
      return lifestyle ? 3.5 : 5;
    // Later shots inherit styling from the initial look
    case "pairing":
      return isInitial || lifestyle ? 5.5 : 7;
    case "footwear":
      return isInitial || lifestyle ? 5.6 : 7.1;
    case "accessory":
      return isInitial ? 6 : 7.5;
    case "garment_extra":
      return 8;
  }
}

// Ranked, de-duplicated and capped: the order they're sent in
export function pickReferences(ctx: PromptContext): Reference[] {
  const seen = new Set<string>();
  const ranked: { ref: Reference; rank: number; index: number }[] = [];
  ctx.references.forEach((ref, index) => {
    if (!ref.url || seen.has(ref.url)) return;
    const r = rank(ref, ctx);
    if (r === null) return;
    seen.add(ref.url);
    ranked.push({ ref, rank: r, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.slice(0, Math.max(0, ctx.maxRefs)).map((entry) => entry.ref);
}

// ---------- Helpers ----------

function isLifestyle(ctx: PromptContext): boolean {
  return ctx.shot.type === "lifestyle" || ctx.background?.setting === "lifestyle";
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function isEthnic(category: string): boolean {
  return /saree|ethnic|kurta|lehenga|salwar|coord|co-ord/i.test(category);
}

// {{product}}, {{category}}, {{gender}}, plus the source's
// image variables ({{front_image}} → "image 1"). Unknown or
// unsent ones are dropped.
function fillVars(text: string, ctx: PromptContext, tags: Tags): string {
  const values: Record<string, string | null> = {
    product: ctx.product.name,
    category: ctx.product.category,
    gender: ctx.product.gender,
    garment_image: tags.garment,
    front_image: tags.garment,
    back_image: tags.back,
    detail_image: tags.detail,
    model_image: tags.face,
    initial_look: tags.initial,
    background: tags.background,
  };
  return text
    .replace(/\{\{[ \t]*([a-z0-9_]+)[ \t]*\}\}/gi, (_, name: string) => values[name.toLowerCase()] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

type Tags = {
  garment: string | null;
  back: string | null;
  detail: string | null;
  face: string | null;
  initial: string | null;
  background: string | null;
};

function tagsFor(refs: Reference[]): Tags {
  const tag = (role: RefRole) => {
    const i = refs.findIndex((r) => r.role === role);
    return i >= 0 ? `image ${i + 1}` : null;
  };
  return {
    garment: tag("garment_front"),
    back: tag("garment_back"),
    detail: tag("garment_detail"),
    face: tag("model_face"),
    initial: tag("initial_look"),
    background: tag("background"),
  };
}

// ---------- Blocks ----------

// "Each reference image has exactly one job" (roleMapBlock)
function imageJobs(refs: Reference[], ctx: PromptContext, tags: Tags): string {
  const later = !ctx.isInitial && Boolean(tags.initial);
  const lines = [`IMAGES (${refs.length}, in order — each has exactly one job, do not mix jobs):`];
  refs.forEach((ref, i) => {
    const label = ref.label ? ` (${clip(ref.label, 80)})` : "";
    lines.push(`- Image ${i + 1}: ${roleJob(ref, ctx, tags, later).replace("{label}", label)}`);
  });
  if (later) {
    lines.push(
      tags.face
        ? `Identity geometry from ${tags.face}; clothes, hair, makeup, skin tone, height and expression from ${tags.initial}. Only pose/crop/camera may change. Never take the outfit from anything but the garment images.`
        : `Copy person, clothes, hair, makeup, skin tone, height and expression from ${tags.initial}. Only pose/crop/camera may change for this shot.`,
    );
  } else if (tags.garment) {
    lines.push(
      `Dress ${tags.face ?? "the model"} in ${tags.garment}. Do not take face, makeup or hair from the garment images.`,
    );
  }
  return lines.join("\n");
}

function roleJob(ref: Reference, ctx: PromptContext, tags: Tags, later: boolean): string {
  switch (ref.role) {
    case "garment_front":
      return later
        ? "GARMENT GROUND TRUTH (front) — the garment's exact color, print/pattern, embroidery, borders and fit come from THIS photo, not the Initial Look (if they differ, this wins). Ignore any person in it.{label}"
        : "CLOTHING ONLY (front) — wear this exact product: same color, print/pattern, embroidery, borders and fit. Ignore any person in it.{label}";
    case "garment_back":
      return "SAME product, back view — exact ground truth for the back's color, print, construction and closures; not a separate garment. Ignore any person in it.{label}";
    case "garment_detail":
      return "SAME product, detail / close-up — exact ground truth for fabric, print, embroidery, trims and stitching; not a separate garment.{label}";
    case "garment_extra":
      return "SAME product, extra view{label} — ground truth for that side's color, print and construction; not a separate garment.";
    case "pairing":
      return "pairing item worn with the product{label} — wear this exact item, unaltered: same color, print, fabric and fit/silhouette. Do not slim, taper, recolor or substitute it.";
    case "footwear":
      return "footwear reference only{label} — wear this exact item, unaltered.";
    case "accessory":
      return "accessory reference only{label} — wear this exact item, unaltered.";
    case "model_face":
      return later
        ? "PRIMARY FACE IDENTITY — match exact face geometry: face shape, eye shape/spacing, brows, nose, lips, jaw and chin, and exact melanin depth. Do NOT copy this photo's makeup, hair style or clothes. Same person, not a lookalike."
        : "PRIMARY FACE IDENTITY — match exact face geometry (face shape, eye shape/spacing, nose, lips, jaw, brows), exact skin depth and undertone, ethnicity, hair as photographed, and natural makeup finish. Ignore the clothes in this photo. Do not beautify or fair-wash.";
    case "initial_look":
      return tags.face
        ? `INITIAL LOOK — MAKEUP + HAIR + OUTFIT + EXPRESSION ground truth: copy the exact makeup (placement and intensity), hair, styling and mood. Face structure is reinforced by ${tags.face}; if skin drifted lighter here, ${tags.face} wins.`
        : "INITIAL LOOK — FACE + MAKEUP + HAIR + OUTFIT ground truth: copy this exact person (same facial geometry), hair, full makeup look, styling and mood. Keep exact melanin depth — never fairer.";
    case "background":
      if (ctx.background?.setting === "lifestyle" || ctx.shot.type === "lifestyle")
        return "LOCATION / MOOD / LIGHT REFERENCE ONLY — not a backdrop to paste onto. Borrow place type, palette and ambient light; recreate a fresh nearby scene and light the person with it as one real exposure.";
      return later
        ? "studio background — SAME studio environment as the Initial Look: identical backdrop color and tone, neutral catalog daylight."
        : "background plate only — photograph the person IN this set as one real exposure.";
    case "previous":
      return "PREVIOUS ATTEMPT of this shot — keep everything that is right in it; change only what the CORRECTION FROM REVIEWER asks.";
  }
}

function personaBlock(ctx: PromptContext, u: Clip): string {
  const { model, product } = ctx;
  if (model?.prompt.trim()) return `MODEL: ${u(model.prompt, 600)}`;
  const kids = /kid/i.test(product.category);
  const who = kids
    ? `a ${product.gender === "female" ? "girl" : "boy"} child model of an age that suits ${product.category}`
    : `a tall adult ${product.gender === "female" ? "woman" : "man"} fashion model`;
  const look = isEthnic(product.category)
    ? "South Asian features, warm natural skin tone"
    : "natural, approachable look";
  return `MODEL: ${who} who fits ${product.category} — ${look}, realistic skin texture, natural dry-to-satin finish, soft natural expression. Same person in every shot.`;
}

// shotPurposeLine + shotFramingLine (no pose image here)
function framingBlock(type: ShotType): string | null {
  switch (type) {
    case "front":
    case "full":
      return "SHOT PURPOSE: primary catalog view — shoppers judge overall look, fit and proportion. FULL LENGTH: head-to-toe with margin — do not crop hem or shoes.";
    case "back":
      return "SHOT PURPOSE: shoppers confirm back construction and fit. BACK: full-length true rear view, head-to-toe with margin — back panel toward camera, face not visible (or only a tiny over-shoulder sliver). Do not turn the model to face the camera.";
    case "side":
      return "SHOT PURPOSE: silhouette check — drape, fit and proportion from the side. FULL LENGTH SIDE: true side / profile camera (not front or three-quarter), head-to-toe with margin. Do not turn the model to face the camera.";
    case "closeup":
    case "detail":
      return "SHOT PURPOSE: shoppers zoom in to judge fabric, print/embroidery and stitching — texture must be crisp and legible. CLOSE-UP: crop tightly to the part of the body the garment covers. No full body.";
    case "lifestyle":
      return "SHOT PURPOSE: helps shoppers picture wearing this day-to-day — the garment still reads true to color and fit, not lost in the scene. Photograph the person naturally in a freshly recreated on-location scene, never pasted onto a plate.";
    default:
      return null;
  }
}

function continuityBlock(ctx: PromptContext, tags: Tags): string {
  const il = tags.initial ?? "the Initial Look";
  const type = ctx.shot.type;
  const lines = [
    "SESSION CONTINUITY (hard constraint — same person, same session look across EVERY shot):",
    `HEIGHT / BODY: same tall adult proportions as ${il}. MAKEUP: identical to ${il} — natural dry-to-satin, never stripped or amplified. SKIN TONE: identical melanin depth and undertone as ${il}${tags.face ? ` (${tags.face} wins if it drifted lighter)` : ""}. COLOR LOOK: same catalog color grade — same garment hue/saturation and white balance on the person.`,
  ];
  if (isLifestyle(ctx)) {
    lines.push(
      "LIFESTYLE EXCEPTION: discard only the Initial Look's studio lighting — re-light with the environment's ambient light. Height, makeup, skin tone, garment color and identity still match exactly.",
    );
  } else {
    lines.push("Only pose and framing may change for this shot.");
    if (type === "side")
      lines.push(
        "SIDE OVERRIDE: the Initial Look is usually front-facing — do NOT keep that orientation. Use a true side camera; identity, outfit and color still match.",
      );
    if (type === "back")
      lines.push(
        "BACK OVERRIDE: the Initial Look is usually front-facing — do NOT keep that orientation. Use a true rear camera; height, hair and any visible face slice still match — never a different person.",
      );
    lines.push(
      "STUDIO SET + COLOR LOCK: same backdrop tone, white balance and light direction as the Initial Look — one continuous catalog session.",
    );
  }
  return lines.join(" ");
}

function lightingBlock(ctx: PromptContext, later: boolean): string {
  if (isLifestyle(ctx)) {
    return "LIFESTYLE LIGHTING (hard constraint — a real on-location DSLR photo, not a paste): face, skin, hair and garment lit only by the scene's ambient light (windows, sky, practicals, bounce) — same direction, softness and color temperature. No studio softbox or beauty light. Soft contact shadows; background mostly sharp with mild separation; no halo or cutout edges.";
  }
  return [
    "STUDIO LIGHTING (hard constraint — a real catalog DSLR shot, not a cutout):",
    later
      ? "match the Initial Look's key/fill direction, intensity, white balance and backdrop color exactly; no extra beauty fill that lightens skin."
      : "neutral daylight studio light (~5200–5600K), soft fill that does not lift skin midtones toward fair; no warm yellow/orange cast on the backdrop.",
    "Soft natural face modeling, faint fabric sheen. Subject tack-sharp, backdrop gently softer. Only a very light contact shadow under feet/hem. No halos, hard edges or floating feet.",
  ].join(" ");
}

function backgroundBlock(ctx: PromptContext, u: Clip): string | null {
  const text = ctx.background?.prompt.trim();
  if (!text) return null;
  if (isLifestyle(ctx)) {
    return `BACKGROUND (recreated scene — any plate or brief is reference only): ${u(text, 500)} Recreate a fresh environment of the same kind, empty of other people; photograph the model there in one coherent exposure.`;
  }
  return `BACKGROUND: ${u(text, 500)}`;
}

// garmentFitDirection
function fitBlock(category: string, garment: string): string {
  const name = category.toLowerCase();
  if (name.includes("saree")) {
    return `GARMENT FIT (saree — hard constraint): keep the blouse from ${garment} (color, fabric, neckline, sleeves), fitted smoothly at shoulders and back. Pleats neat and pressed at the natural waist; pallu drape follows ${garment}. Border placement and length match; fabric freshly steamed.`;
  }
  if (isEthnic(name)) {
    return `GARMENT FIT (ethnic set — hard constraint): copy the exact cut, silhouette and volume from ${garment} — never slim or loosen it. Smooth pressed fabric, boutique-ironed finish. Do not add a dupatta/stole unless ${garment} already shows one.`;
  }
  return `GARMENT FIT (hard constraint): copy the exact fit and silhouette from ${garment} — length, looseness/volume and hem shape identical. Never slim, taper or tighten a loose cut (or loosen a fitted one). Fabric clean and unwrinkled.`;
}

// referenceOutputQuality, condensed
function qualityBlock(type: ShotType, isInitial: boolean): string {
  const base =
    "REFERENCE QUALITY: high-end studio lookbook — print, pattern, embroidery and borders replicated exactly (same motifs, scale, spacing and colors; never simplified or redrawn). Every zipper, logo, button, label and trim matches the product photos in position, size, color and finish — none added, removed or mirrored.";
  if (isInitial) return `${base} LOOK SHOT: complete outfit head-to-toe with margin, tall adult proportions, natural dry-to-satin skin.`;
  if (type === "back") return `${base} BACK: back panel and hem as sharp and pressed as the front; same light as the front shots.`;
  if (CLOSE.includes(type)) return `${base} CLOSE-UP: garment fills 85%+ of the frame; macro-clean texture; no full body.`;
  return base;
}

function colorLock(garment: string): string {
  return `GARMENT COLOR — DO NOT CHANGE (hard constraint): the garment's own color never changes from ${garment}. Do not recolor it, make it lighter or darker, or shift its hue to "match" the background, skin or mood. Only how light falls on it (natural highlight and shadow) may vary; the base color stays identical to the reference. Dark-wash or near-black fabric must still read dark — never faded to a mid-tone.`;
}

// ---------- Build ----------

type Block = { text: string; drop?: number };

// Clips user text to max * the current budget scale
type Clip = (text: string, max: number, min?: number) => string;

export function buildShotRequest(ctx: PromptContext): { prompt: string; references: string[] } {
  const refs = pickReferences(ctx);
  // Over budget: shrink the free-text fields step by step
  let prompt = "";
  for (const scale of [1, 0.75, 0.55, 0.4, 0.28, 0.18, 0.1]) {
    const u: Clip = (text, max, min = 80) => clip(text, Math.max(min, Math.round(max * scale)));
    prompt = fit(blocksFor(ctx, refs, u));
    if (prompt.length <= PROMPT_TARGET) break;
  }
  return { prompt, references: refs.map((r) => r.url) };
}

function blocksFor(ctx: PromptContext, refs: Reference[], u: Clip): Block[] {
  const tags = tagsFor(refs);
  const later = !ctx.isInitial;
  const garment = tags.garment ?? "the garment reference";
  const { product, shot } = ctx;
  // Lower `drop` goes first when over budget; none = kept
  const blocks: Block[] = [];
  const add = (text: string | null | undefined, drop?: number) => {
    if (text && text.trim()) blocks.push({ text: text.trim(), drop });
  };

  add(
    `Catalogue photograph for an online fashion store: "${clip(product.name, 120)}" (${product.category}, ${product.gender}). ` +
      (ctx.isInitial
        ? "This is the INITIAL LOOK — the hero shot every later shot must match."
        : `This is the "${clip(shot.label, 60)}" shot of the same set.`),
  );
  if (refs.length) add(imageJobs(refs, ctx, tags));

  if (tags.face) {
    add(
      `SKIN DEPTH LOCK (hard constraint — failure if violated): match ${tags.face}'s melanin depth on face, neck, chest, arms and hands — the same darkness as the model face photo, same undertone. FORBIDDEN: fair-wash, porcelain bleach, beauty-light whitening, blown highlights or fake glow brightening.`,
    );
  }
  if (later) add(continuityBlock(ctx, tags));
  else
    add(
      "CANONICAL LOOK (this shot defines the pack): lock tall adult height, makeup finish (natural dry-to-satin, not dewy), exact skin tone and a neutral catalog color grade — every later shot must match these exactly.",
    );
  if (tags.face) {
    add(
      [
        "FACE + HAIR LOCK (hard constraint — highest priority for identity):",
        `IDENTITY: same person as ${tags.face} — bone structure, eye shape/spacing, nose, lips, jaw, brows, cheekbones. Not a lookalike or beautified catalog face.`,
        tags.initial
          ? `Makeup and hair from ${tags.initial}; face geometry and skin depth from ${tags.face}.`
          : `HAIR from ${tags.face}: exact length, color, texture and style.`,
        "SKIN FINISH: natural dry-to-satin with visible texture — no dewy, glass or oily skin. No beautify, reshape or lighten.",
      ].join(" "),
    );
  }

  // Persona text (the initial look carries it later on)
  if (ctx.isInitial || !tags.initial) add(personaBlock(ctx, u));

  if (FULL_LENGTH.includes(shot.type)) {
    add(
      `BODY PROPORTION LOCK: tall adult catalog proportions — elongated legs, normal head-to-body ratio (~1:7–1:8). ${
        later && tags.initial
          ? `Match ${tags.initial}'s perceived height and leg length exactly.`
          : "Full-length with hem and shoes in frame."
      } FORBIDDEN: short/stocky build, oversized head, compressed legs.`,
      3,
    );
  }

  const pose = ctx.pose?.prompt.trim();
  if (pose) {
    add(
      `POSE (text brief — body stance, expression mood and camera framing; apply to the locked identity, never change face or skin):\n${u(pose, 1200)}`,
    );
  }
  add(framingBlock(shot.type), 4);

  const shotText = fillVars(shot.prompt, ctx, tags);
  if (shotText) {
    add(`SHOT:\n${u(shotText, 1200)}`);
    add(
      "SHOT GUARD: mood words in SHOT must not change face identity, skin depth or makeup.",
      2,
    );
  }

  if (ctx.accessories.length) {
    const names = ctx.accessories.map((a) => `- ${clip(a.name, 60)}${a.prompt.trim() ? `: ${u(a.prompt, 160, 60)}` : ""}`);
    add(
      later && tags.initial
        ? "ACCESSORIES (same as Initial Look): keep exactly the accessories on the Initial Look — do not invent, omit or substitute."
        : ["ACCESSORIES: wear these, only where visible in this frame — do not change the pose to show them:", ...names].join("\n"),
    );
  }

  const pairingSent = refs.some((r) => r.role === "pairing");
  const footwearSent = refs.some((r) => r.role === "footwear");
  if (pairingSent) {
    add(
      "PAIRING LAYERING: the product stays the hero piece. Wear every pairing item in its natural position — inner layers underneath and visible where the product opens, bottomwear on the lower body, dupatta/stole draped.",
    );
  } else if (later && tags.initial) {
    add(
      "PAIRING / FOOTWEAR (same as Initial Look): keep every pairing item and the footwear exactly as in the Initial Look — do not alter, drop or substitute any.",
      5,
    );
  }
  if (footwearSent && !pairingSent) add("FOOTWEAR: wear the footwear image's exact pair.", 5);

  if (ctx.isInitial || !tags.initial) {
    const styling = fillVars(ctx.styling, ctx, tags);
    if (styling) {
      add(
        `STYLING (secondary — body and garment vibe only; never overrides face, skin depth or makeup):\n${u(styling, 600)}`,
      );
    }
    const wear = ctx.model?.notes.trim();
    if (wear) {
      add(
        `WEAR STYLE (how this model wears clothes — technique only; length, fit and volume still come from ${garment}):\n${u(wear, 400)}`,
      );
    }
  }

  add(lightingBlock(ctx, later && Boolean(tags.initial)));
  add(backgroundBlock(ctx, u));
  if (product.notes.trim()) add(`Product notes: ${u(product.notes, 500)}`);
  add(fitBlock(product.category, garment), 6);
  add(qualityBlock(shot.type, ctx.isInitial), 1);
  add(colorLock(garment));
  add(OUTPUT_SHARPNESS);
  if (ctx.feedback.trim()) add(`${CORRECTION_HEADING}\n${u(ctx.feedback, 1000, 400)}`);

  return blocks;
}

// Drop optional blocks (lowest first) until under budget
function fit(blocks: Block[]): string {
  const join = (list: Block[]) => list.map((b) => b.text).join("\n\n");
  let list = blocks;
  const order = blocks
    .filter((b) => b.drop !== undefined)
    .sort((a, b) => (a.drop ?? 0) - (b.drop ?? 0));
  for (const block of order) {
    if (join(list).length <= PROMPT_TARGET) break;
    list = list.filter((b) => b !== block);
  }
  return join(list);
}

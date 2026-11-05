// --------------------------------------------------
// CATALOGUE: the legacy engine's buildPrompt, word for
// word (ai-catalog-backend src/services/productGeneration.js
// 436-1378). Line refs in comments are to that file.
// --------------------------------------------------

import {
  isCatalogCloseupShot,
  isDynamicCloseupShot,
  isDynamicShot,
  referenceOutputQuality,
  variablePattern,
  GARMENT_SLOT_LABEL,
  type PromptShot,
} from "./constants";
import { TEMPLATE_VARIABLES, imgTag, isExtraGarmentAngle } from "./references";
import type { OrigRef, SkinDepthNote } from "./types";

// ---------- roleMapBlock (436) ----------

/** One short role map — each reference image has exactly one job. */
export function roleMapBlock(
  references: OrigRef[],
  {
    isInitial = false,
    hasInitialLook = false,
    backgroundInherited = true,
    lifestyleBackground = false,
  }: { isInitial?: boolean; hasInitialLook?: boolean; backgroundInherited?: boolean; lifestyleBackground?: boolean } = {},
): string {
  const refs = Array.isArray(references) ? references : [];
  const modelTag = imgTag(references, TEMPLATE_VARIABLES.model_image);
  const initialTag = imgTag(references, TEMPLATE_VARIABLES.initial_look);
  const garmentRefs = refs.filter((r) => r?.role === "garment");
  const primaryGarment = garmentRefs.find((g) => !isExtraGarmentAngle(g)) ?? garmentRefs[0] ?? null;
  const garmentTag = primaryGarment ? `@img${refs.indexOf(primaryGarment) + 1}` : null;
  const poseTag = imgTag(references, TEMPLATE_VARIABLES.pose_image);
  const bgTag = imgTag(references, TEMPLATE_VARIABLES.background);
  const pairingTag = imgTag(references, (r) => r?.role === "pairing");
  const referenceRef = refs.find((r) => r?.role === "reference") ?? null;
  const referenceTag = referenceRef ? `@img${refs.indexOf(referenceRef) + 1}` : null;
  const footwearTag = imgTag(references, (r) => r?.role === "footwear");
  const accessoriesTag = imgTag(references, (r) => r?.role === "accessories");
  const stylingRef = refs.find((r) => r?.role === "styling");
  const stylingTag = stylingRef ? `@img${refs.indexOf(stylingRef) + 1}` : null;
  const lines = ["ROLE MAP (do not mix jobs):"];

  if (hasInitialLook && initialTag && modelTag) {
    lines.push(
      `- ${modelTag}: PRIMARY FACE IDENTITY (first reference — highest fidelity) — match EXACT face geometry from this tight face crop: face shape (round/oval/heart as photographed), eye shape and spacing, eyelid crease, brow arch, nose bridge/tip/width, lip shape/fullness, jaw and chin. Exact melanin depth (dusky/dark stays that dark). Do NOT copy this photo's makeup, blush, lipstick, liner, eyeshadow, contour, highlighter, hair style, or clothes. Not a lookalike — same person.`,
    );
    lines.push(
      `- ${initialTag}: MAKEUP + HAIR + OUTFIT + EXPRESSION ground truth — copy the exact makeup look (blush amount/color, lipstick/lip tint, liner, eyeshadow, contour, highlighter — same placement and intensity), hair (length/color/texture/parting/style), clothes, and mood from this photo. Face bone structure is reinforced by ${modelTag}; makeup finish must match Initial Look, never the model face photo. SKIN DEPTH from ${modelTag} wins if Initial Look drifted lighter — never fair-wash.`,
    );
  } else if (hasInitialLook && initialTag) {
    lines.push(
      `- ${initialTag}: FACE + MAKEUP + HAIR + OUTFIT ground truth — copy this exact person (same facial geometry: eyes, nose, lips, jaw, brows — never reinterpret), clothes, hair (length/color/texture/style — straight stays straight, curly stays curly), and full makeup look (blush, lipstick/lip color, liner, eyeshadow, contour, highlighter, brow fill — same colors, placement, and intensity). Keep exact melanin depth (dusky/dark stays dusky/dark — never fairer, brighter, or fair-washed).`,
    );
  } else if (modelTag) {
    lines.push(
      `- ${modelTag}: PRIMARY FACE IDENTITY (first reference — highest fidelity) — match EXACT face geometry from this tight face crop: face shape (round/oval as photographed), eye shape/spacing, nose bridge/tip/width, lip shape, jaw/chin, brows. Exact skin depth and undertone (dusky/dark stays dusky/dark — never lighten), ethnicity, hair (length, color, texture, style as photographed; never restyle from the pose), and makeup finish as photographed (natural satin — not dewy/glass). Ignore clothes in this photo. Do not beautify, fair-wash, or swap features. The full-body output face must be recognizably the SAME person — not a lookalike, not a fairer prettier catalog substitute.`,
    );
  }

  if (garmentTag) {
    lines.push(
      hasInitialLook
        ? `- ${garmentTag}: GARMENT GROUND TRUTH — the garment's exact color, print/pattern, embroidery, borders, and fit come from THIS photo, not from Initial Look (if Initial Look drifted, this photo wins). Face/makeup/hair from model/Initial Look. Ignore people in this photo.`
        : `- ${garmentTag}: CLOTHING ONLY — wear this exact product: same color, print/pattern, embroidery, borders, and fit. Ignore people in this photo.`,
    );
  }
  for (const ref of garmentRefs) {
    if (ref === primaryGarment) continue;
    const tag = `@img${refs.indexOf(ref) + 1}`;
    const label = GARMENT_SLOT_LABEL[String(ref.slot)] || "other";
    lines.push(
      `- ${tag}: SAME product, ${label} view — exact ground truth for that side's color, print/pattern, embroidery, and construction; not a separate garment. Ignore people in this photo.`,
    );
  }
  for (const patternRef of refs.filter((r) => r?.role === "pattern")) {
    lines.push(
      `- @img${refs.indexOf(patternRef) + 1}: PATTERN SWATCH (${patternRef.label}) — full-resolution close crop of the product's print. That printed area must match it exactly: same motifs, motif scale, spacing, line work, and colors, only where it appears on the product. Never simplify or redraw it.`,
    );
  }
  if (stylingTag && stylingRef) {
    lines.push(
      `- ${stylingTag}: outfit styling reference only — panels side by side, left to right: ${stylingRef.label}. Each panel is a separate item; wear each item exactly (same color, print, fabric, design, fit and silhouette, unaltered). Do not copy background/model from it.`,
    );
  }
  if (pairingTag) {
    const pairingRef = refs.find((r) => r?.role === "pairing");
    const detail = pairingRef?.label ? ` (${pairingRef.label})` : "";
    lines.push(
      `- ${pairingTag}: pairing item worn with the product${detail} — e.g. inner layer, bottomwear, or dupatta; wear this exact item, unaltered. Match its color, print, fabric, and exact fit/silhouette (leg width, looseness, length) precisely; do not slim, taper, reinterpret, recolor, or substitute a different garment.`,
    );
  }
  if (footwearTag) {
    lines.push(`- ${footwearTag}: footwear reference only — wear this exact item, unaltered.`);
  }
  if (accessoriesTag) {
    const accessoriesRef = refs.find((r) => r?.role === "accessories");
    const detail = accessoriesRef?.label ? ` (${accessoriesRef.label})` : "";
    lines.push(
      `- ${accessoriesTag}: accessories reference only${detail} — wear these exact items, unaltered. If the image has multiple panels, each panel is a separate accessory.`,
    );
  }
  if (referenceTag) {
    lines.push(`- ${referenceTag}: user-supplied regeneration reference — follow its guidance for this retry.`);
  }
  // Not in the original (ours: the attempt being corrected)
  const previousTag = imgTag(references, (r) => r?.role === "previous");
  if (previousTag) {
    lines.push(
      `- ${previousTag}: PREVIOUS ATTEMPT of this shot — keep everything that is right in it; change only what the CORRECTION FROM REVIEWER asks.`,
    );
  }
  if (poseTag) {
    lines.push(
      `- ${poseTag}: BODY STANCE + CAMERA + FRAME ONLY — copy this exact pose: hand/arm positions (anatomically complete — no missing or melted limbs), weight/stance, torso angle, head turn, and gaze direction, plus the same camera angle and crop. Different, unrelated person — NEVER copy their face, makeup, skin tone, hair (ignore curly/straight/texture completely), clothes, jewelry/accessories (bangles, rings, earrings, necklace, maang tikka, belts, bags), or background. Props: only a minimal stance prop if the pose needs it to hold the body (e.g. lean on a chair/ledge) — never jewelry or decorative accessories from the pose stand-in.`,
    );
  }
  if (bgTag) {
    if (lifestyleBackground) {
      lines.push(
        `- ${bgTag}: LOCATION / MOOD / LIGHT REFERENCE ONLY — not a backdrop to paste onto. Borrow place type, architecture, palette, and especially the real ambient lighting character. Invent a fresh nearby scene of the same kind; re-light the person with that environment's raw light as one real exposure. Never clone, crop-in, or composite over this exact plate.`,
      );
    } else if (hasInitialLook && backgroundInherited) {
      lines.push(
        `- ${bgTag}: SAME studio environment as Initial Look — identical wall/floor/backdrop color and tone. Neutral catalog daylight only — do not shift hue, warmth, yellow/orange cast, or white balance vs the Initial Look plate.`,
      );
    } else if (hasInitialLook) {
      lines.push(
        `- ${bgTag}: NEW environment — place the person in this exact location, replacing the Initial Look's studio background.`,
      );
    } else {
      lines.push(`- ${bgTag}: background plate only.`);
    }
  }

  if (hasInitialLook && initialTag && modelTag) {
    lines.push(
      lifestyleBackground
        ? `Identity geometry from ${modelTag}; clothes, hair, makeup, skin tone, height/proportions, garment color, and expression from ${initialTag}. Discard Initial Look studio lighting — re-light with the lifestyle environment's raw ambient light only. Pose/crop/camera may change. FORBIDDEN: stripping makeup, changing skin tone, shrinking height, or regrading color vs ${initialTag}.`
        : `Identity geometry from ${modelTag}; clothes, hair, makeup, skin tone, height/proportions, garment color grade, and mood/expression from ${initialTag}. Only pose/crop/camera may change. FORBIDDEN: stripping makeup, fair-washing skin, shrinking height, or shifting color look vs ${initialTag}.`,
    );
  } else if (hasInitialLook && initialTag) {
    lines.push(
      lifestyleBackground
        ? `Copy person, clothes, hair, makeup, skin tone, height/proportions, garment color, and expression from ${initialTag}. Discard its studio lighting entirely — re-light the person with the lifestyle environment's raw ambient light only. Pose/crop/camera may change.`
        : `Copy person, clothes, hair, makeup, skin tone, height/proportions, color look, and mood/expression from ${initialTag}. Only pose/crop/camera may change for this shot.`,
    );
  } else if (isInitial && garmentTag) {
    lines.push(
      `Dress ${modelTag || "the model"} in ${garmentTag}. FACE TRANSFER (hard constraint): the output face must be recognizably the SAME person as ${modelTag || "the model face reference"} — same eye shape/spacing, nose, lips, jaw, brows, cheekbones, and face proportions. Not a lookalike, not a beautified catalog face. Face, makeup, and hair come only from the model reference — do not take outfit from pose or face/hair/makeup from garment. SKIN DEPTH LOCK: match ${modelTag || "the model face reference"}'s exact melanin depth on face, neck, chest, and hands — if the headshot is dusky/dark/medium-dark, the full-body skin MUST stay that dark, keeping the same warm olive undertone (South Asian warmth is correct). FORBIDDEN: fair-washing, lightening, porcelain glow, or a fake honey-golden glow that brightens the skin. Soft natural expression matching the headshot — not a blank stock stare. Keep studio wall/backdrop at neutral daylight white balance (no extra yellow/orange grade on the set).`,
    );
  } else {
    lines.push("Do not take outfit from pose. Do not take face, makeup, or hair from garment or pose.");
  }
  return lines.join("\n");
}

// ---------- shotFramingLine (572) / shotPurposeLine (618) ----------

function isFullLengthCatalogShot(shotType: string): boolean {
  if (isCatalogCloseupShot(shotType)) return false;
  if (shotType === "closeup_dynamic_front" || shotType === "closeup_dynamic_back") return false;
  return (
    shotType === "initial" ||
    shotType === "front" ||
    shotType === "front_full_sleeve" ||
    shotType === "side" ||
    shotType === "back" ||
    shotType === "lifestyle" ||
    shotType === "dynamic_lifestyle"
  );
}

export function shotFramingLine(shotType: string, garmentTag: string | null, poseTag: string | null): string | null {
  const garment = garmentTag || "the garment reference";
  switch (shotType) {
    case "back":
      return poseTag
        ? `BACK ANGLE (hard constraint — wins over front-facing Initial Look continuity): camera must stay a true rear view matching ${poseTag}'s body orientation — back panel, shoulders, and hem toward camera. FORBIDDEN: rotating the torso or face toward camera into a front or three-quarter catalog pose just to show more of the Initial Look face. Prefer face fully away / not readable unless ${poseTag} already shows a slight over-shoulder glance.`
        : "BACK: full-length rear view, head-to-toe with margin — back panel toward camera, face not visible (or only a tiny over-shoulder sliver). Do not turn the model to face the camera.";
    case "closeup":
      return poseTag
        ? null
        : `CLOSE-UP: crop tightly to whichever part of the body the garment in ${garment} covers — show maximum fabric/print/embroidery detail. No full body.`;
    case "closeup_front":
      return poseTag
        ? null
        : `CLOSE-UP FRONT: crop tightly on the front of whichever part of the body the garment in ${garment} covers — show maximum fabric/print/embroidery detail from the front. No full body.`;
    case "closeup_back":
      return poseTag
        ? `CLOSE-UP BACK ANGLE (hard constraint): stay rear / over-shoulder matching ${poseTag} — back fabric is the hero. FORBIDDEN: turning to a front-facing face portrait. If any cheek/jaw/eye is visible, it must be the Initial Look person — never the pose stand-in.`
        : `CLOSE-UP BACK: crop tightly on the back of whichever part of the body the garment in ${garment} covers — show maximum fabric/print/embroidery detail from the back, face not visible. No full body.`;
    case "closeup_dynamic_front":
      return `DYNAMIC CLOSE-UP: full creative freedom on angle and framing — bold, editorial, runway/campaign energy. Garment in ${garment} stays hero-sharp and clearly readable, whatever the crop.`;
    case "closeup_dynamic_back":
      return `DYNAMIC CLOSE-UP BACK: full creative freedom on rear/over-shoulder angle and framing — bold, editorial, runway/campaign energy. Garment in ${garment} stays hero-sharp and clearly readable, whatever the crop. If any face is visible, it must match Initial Look identity — never invent or copy the pose/reference stand-in.`;
    case "lifestyle":
    case "dynamic_lifestyle":
      return poseTag
        ? `LIFESTYLE FRAME (hard constraint): match ${poseTag}'s exact crop and subject-vs-background fill — full-height stays full-height; tighter stays tighter. The lifestyle plate is mood/location reference only — recreate the environment behind the subject; do not paste the person onto the plate.`
        : "LIFESTYLE: photograph the person naturally in a freshly recreated on-location scene inspired by the mood/location reference — never pasted or masked onto the plate.";
    case "front":
    case "front_full_sleeve":
      return poseTag ? null : "FULL LENGTH: head-to-toe with margin — do not crop hem or shoes.";
    case "side":
      return poseTag
        ? `SIDE ANGLE (hard constraint — wins over front-facing Initial Look continuity): camera must stay a true side / profile view matching ${poseTag}'s body orientation — silhouette in profile (shoulder line, bust/waist/hip, drape). FORBIDDEN: rotating the torso or face toward camera into a front or three-quarter catalog pose just to show more of the Initial Look face.`
        : "FULL LENGTH SIDE (hard constraint): true side / profile camera — body silhouette in profile (not front or three-quarter). Head-to-toe with margin — do not crop hem or shoes. Do not turn the model to face the camera.";
    case "initial":
      return poseTag ? null : "match the pose reference's exact crop/framing.";
    case "mood":
      return "MOOD: editorial dark-studio portrait — the shot's own background/lighting direction overrides any inherited plate. Garment stays hero-sharp despite dramatic light.";
    default:
      return isFullLengthCatalogShot(shotType) && !poseTag
        ? "FULL LENGTH: head-to-toe with margin — do not crop hem or shoes."
        : null;
  }
}

export function shotPurposeLine(shotType: string): string | null {
  switch (shotType) {
    case "initial":
      return null;
    case "front":
    case "front_full_sleeve":
      return "SHOT PURPOSE: primary catalog view — shoppers judge overall look, fit, and proportion from this angle.";
    case "side":
      return "SHOT PURPOSE: silhouette check from a TRUE SIDE / PROFILE camera — shoppers judge drape, fit, and proportion from the side. Not a front or three-quarter pose.";
    case "back":
      return "SHOT PURPOSE: shoppers check this to confirm back construction and fit — true REAR camera, back panel, seams, closures, hem, or dupatta fall must read clearly. Face should stay away from camera (not a front portrait).";
    case "closeup":
    case "closeup_front":
    case "closeup_back":
    case "closeup_dynamic_front":
    case "closeup_dynamic_back":
      return "SHOT PURPOSE: shoppers zoom in here to judge fabric quality, print/embroidery, and stitching before buying — texture and craftsmanship must be crisp and legible.";
    case "lifestyle":
      return "SHOT PURPOSE: helps shoppers picture themselves wearing this day-to-day — garment must still read true to color and fit, not lost in the scene.";
    case "dynamic_lifestyle":
      return "SHOT PURPOSE: campaign-style aspiration shot that builds desire — garment must still stay identifiable and true to color, not upstaged by the scene.";
    case "mood":
      return "SHOT PURPOSE: campaign/editorial energy — builds desire through mood and lighting, garment must still read true to color and detail.";
    default:
      return null;
  }
}

// ---------- Lighting (1117 / 1131) ----------

export function lifestyleLightingPromptLine(): string {
  return [
    "LIFESTYLE INTEGRATION (hard constraint — real on-location DSLR photo, not a paste):",
    "The lifestyle background image is REFERENCE ONLY for mood and place — recreate a fresh scene; never composite the person onto that plate.",
    "RAW ENVIRONMENT LIGHT on the person (hard constraint): face, skin, and hair must be lit only by the scene's real ambient light — same direction, softness, intensity, and falloff as the environment (windows/sky/practicals/bounce).",
    "GARMENT COLOR — DO NOT CHANGE: the garment's own color never changes from the garment / Initial Look reference — only how light falls on it (highlight/shadow) may vary with the scene. Do not warm, cool, tint, brighten, wash out, or oversaturate the clothes; a dark-wash or near-black garment must still read dark-wash or near-black after lighting is applied.",
    "HIGHLIGHTS (very minimal): at most a faint forehead/nose specular and faint fabric sheen where the environment light naturally hits — natural dry-to-satin skin, NOT dewy/glass/oily cheeks. No blown face highlights, no oily beauty-dish glare.",
    "Strip ALL studio lighting from the Initial Look: no softbox, beauty dish, hard catalog key/fill/rim, or flat front beauty light on the model. Studio-lit subject + environmental background = failed paste.",
    "Include ambient bounce and subtle contact shadows/occlusion so the person belongs in the room.",
    "Depth of field: keep background mostly sharp and readable with only a very mild softening for natural separation — reduce blur; no heavy shallow-DOF, creamy bokeh, or milky haze.",
    "One coherent exposure: matching perspective, soft edge light wrap, no halo/matte edges, no mismatched lighting, no photoshopped look.",
  ].join(" ");
}

export function studioIntegrationPromptLine({
  matchInitialLook = false,
  darkSkin = false,
}: { matchInitialLook?: boolean; darkSkin?: boolean } = {}): string {
  return [
    "STUDIO INTEGRATION (hard constraint — real catalog DSLR shot, not cutout/composite):",
    matchInitialLook
      ? "Subject must match the Initial Look's studio lighting and backdrop color exactly — same key/fill/rim direction, intensity, white balance, and color temperature on face, skin, hair, and garment; soft bounce must match. Do not add a different hue or grade on the set. Face identity, exposure, skin depth, and makeup look must match Initial Look exactly — no extra beauty fill that lightens skin; do not strip, restyle, or redraw facial features."
      : "Subject must be lit by the backdrop's studio setup — same key/fill/rim direction, intensity, and neutral daylight color temperature on face, skin, hair, and garment; soft bounce must match the set. No warm yellow/orange grade on wall/backdrop (skin undertone from the model face stays). Face identity and melanin depth stay locked to the model face reference.",
    matchInitialLook
      ? "LIGHTING HIGHLIGHTS: soft naturalistic face modeling matching Initial Look — faint forehead/nose specular only; soft chin shadow; faint garment sheen. KEEP Initial Look makeup colors but at natural satin intensity — do NOT amplify into dewy/glass/wet highlighter. FORBIDDEN: blown face highlights, oily beauty-dish glare, dewy cheeks."
      : darkSkin
        ? "LIGHTING HIGHLIGHTS (dark skin): soft chin/nose shadow for depth; only very faint forehead/nose specular. Do not put bright cheek glare that lightens melanin. Faint garment sheen. FORBIDDEN: dewy/glass skin, blown/overexposed face, oily beauty-dish glare, porcelain glow."
        : "LIGHTING HIGHLIGHTS: soft naturalistic face modeling — faint forehead/nose specular and soft chin/nose shadow; faint garment sheen. Natural dry-to-satin skin, not dewy. Keep melanin depth true. FORBIDDEN: dewy/glass skin, wet cheek highlighter, blown/overexposed face, oily beauty-dish glare.",
    "Slight optical depth of field — subject sharp, studio backdrop gently softer than the person (subtle, catalog-natural — not heavy bokeh).",
    "SHADOWS (minimal but natural): only a very light, soft contact shadow under feet/hem for grounding — barely visible. No heavy, dark, long, or dramatic floor shadows; no harsh body cast shadows. Still must look like a real studio photo, not floating.",
    "Natural edge softness with light wrap/spill from the set.",
    "Avoid hard cutout edges, halos, gray fringe, floating feet, mismatched lighting, or any photoshopped/AI-composited appearance.",
  ].join(" ");
}

// ---------- Template variables (1163 / 1173) ----------

export function bindReferencePlaceholders(text: string, references: OrigRef[]): string {
  if (!text?.includes("{{")) return text;
  const refs = Array.isArray(references) ? references : [];
  return text.replace(variablePattern(), (_, name: string) => {
    const which = TEMPLATE_VARIABLES[String(name).toLowerCase()];
    if (!which) return "";
    return imgTag(refs, which) ?? "";
  });
}

export function resolveTemplateVariables(text: string, references: OrigRef[]): string {
  if (!text.includes("{{")) return text;
  const refs = Array.isArray(references) ? references : [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    let missing = false;
    const resolved = line.replace(variablePattern(), (_, name: string) => {
      const which = TEMPLATE_VARIABLES[name.toLowerCase()];
      const tag = which ? imgTag(refs, which) : null;
      if (!tag) missing = true;
      return tag ?? "";
    });
    if (!missing) kept.push(resolved);
  }
  return kept.join("\n");
}

// ---------- Wear style / fit (1190-1277) ----------

export function isEthnicCategory(categoryName: string | null | undefined): boolean {
  const name = String(categoryName ?? "").toLowerCase();
  return (
    name.includes("saree") ||
    name.includes("coord") ||
    name.includes("ethnic") ||
    name.includes("lehenga") ||
    name.includes("kurta") ||
    name.includes("salwar")
  );
}

type WearStyleSource = { wearStyleNotes?: string | null; productCategories?: string[] } | null | undefined;

export function wearStyleApplies(
  source: WearStyleSource,
  product: { categoryId?: string | null } | null | undefined,
  categoryName: string | null | undefined,
): boolean {
  if (!source?.wearStyleNotes?.trim()) return false;
  if (!isEthnicCategory(categoryName)) return false;
  if (source.productCategories?.length && product?.categoryId) {
    return source.productCategories.includes(product.categoryId);
  }
  return true;
}

export function wearStylePromptBlock(notes: string): string {
  return [
    "WEAR STYLE LOCK (draping technique only — from a different reference photo):",
    notes.trim(),
    "Apply only this draping/arrangement technique to {{garment_image}} on the model. Garment length, hemline, fit, and volume must come entirely from {{garment_image}} — never from the reference photograph this technique was described from.",
    "Ignore any jewelry/accessory pairing mentioned in WEAR STYLE (bangles, necklace, earrings, maang tikka, etc.) — accessories come only from the product accessories reference / Initial Look, never from wear-style notes or the pose photo.",
  ].join("\n");
}

export function stylingAllowsBlouseChange(modelAppearanceNotes: string | null | undefined): boolean {
  const text = String(modelAppearanceNotes ?? "").toLowerCase();
  if (!text.trim()) return false;
  return /\b(blouse|choli)\b/.test(text);
}

export function garmentFitDirection(
  categoryName: string | null | undefined,
  garmentToken: string | null,
  {
    lockBlouseToProduct = true,
    restyleBlouse = false,
    poseLocked = false,
  }: { lockBlouseToProduct?: boolean; restyleBlouse?: boolean; poseLocked?: boolean } = {},
): string {
  const ref = garmentToken || "the garment reference";
  const name = String(categoryName ?? "").toLowerCase();
  if (name.includes("saree")) {
    let blouseLine: string;
    if (restyleBlouse) {
      blouseLine =
        "BLOUSE (from STYLING only — not from product refs): follow STYLING for blouse design/color/sleeves. Saree body, print, borders, and pallu still match the product reference exactly. Fit: sit smoothly at shoulders and back — fitted to the torso, not boxy.";
    } else if (lockBlouseToProduct) {
      blouseLine = `SAME BLOUSE: keep the blouse from ${ref} (color, fabric, neckline, sleeves, design) unless STYLING explicitly asks to change it. Fit: sit smoothly at shoulders and back — fitted to the torso, not boxy or oversized.`;
    } else {
      blouseLine = "Blouse: same as Initial Look — fitted smoothly at shoulders and back, not boxy or oversized.";
    }
    const palluLine = poseLocked
      ? `Pleats at waist neat and pressed; pallu drape follows ${ref} — smooth controlled fall. Do not let the pallu or saree fabric erase, melt, or invent broken arms/hands — limb visibility must still match the pose reference.`
      : `Pleats at waist neat, pressed, and sit at natural waist height; pallu drape follows ${ref} — smooth controlled fall, not crushed or rumpled.`;
    return [
      "GARMENT FIT (saree — hard constraint):",
      blouseLine,
      palluLine,
      "Border placement and length match the product reference; fabric freshly steamed — no creasing or bunching.",
    ].join("\n");
  }
  if (name.includes("salwar")) {
    return [
      "GARMENT FIT (salwar kameez — hard constraint):",
      `Kameez/kurta freshly pressed — smooth front panel, crisp shoulder line, natural uncrushed hem fall matching ${ref}.`,
      "Salwar/churidar/palazzo smooth and unwrinkled — clean vertical drape, not bunched at ankles or knees.",
      `Dupatta draped cleanly per ${ref} — smooth shoulder fall, full length visible head-to-hem with ornate border uncropped, no crushing or tangled folds hiding garment details.`,
    ].join("\n");
  }
  if (name.includes("coord") || name.includes("kurta") || name.includes("lehenga")) {
    return [
      "GARMENT FIT (ethnic set — hard constraint):",
      `Match the silhouette and ease from ${ref} — smooth pressed fabric at shoulders, bodice, and waist.`,
      `Copy the exact cut and volume from ${ref} — never slim or loosen it. Not crushed or rumpled — boutique ironed finish.`,
      "Bottomwear volume smooth and elegant — no accordion creases or squashed fabric.",
      `Do not add a dupatta/stole unless ${ref} or the Initial Look already shows one.`,
    ].join("\n");
  }
  return [
    "GARMENT FIT (hard constraint):",
    `Copy the exact fit and silhouette from ${ref} — leg width, looseness/volume, rise, length, and hem shape identical. If ${ref} is baggy, wide-leg, loose, or oversized, keep that full volume; never slim, taper, straighten, or tighten it (and never loosen a fitted cut).`,
    "Same exact fit rule applies to any pairing/styling item — copy its cut and volume from its own reference image.",
    "Fabric clean and unwrinkled (no crushed or rumpled creases) — smooth fabric does NOT mean a slimmer fit.",
  ].join("\n");
}

// ---------- Background notes (1301) ----------

type PromptBackground = { prompt: string; backgroundType: "studio" | "lifestyle" | null } | null;

export function backgroundScenePromptBlock(
  background: PromptBackground,
  shotType: string,
  { poseLocked = false }: { poseLocked?: boolean } = {},
): string {
  const text = background?.prompt?.trim();
  if (!text || !background) return "";

  const lifestyle = background.backgroundType === "lifestyle";
  if (!lifestyle) {
    return ["BACKGROUND NOTES (apply to this shot):", text].join("\n");
  }

  const closeup = isCatalogCloseupShot(shotType);

  return [
    "BACKGROUND (recreated scene — hard constraint; any plate/brief is REFERENCE ONLY):",
    text,
    "Recreate a fresh environment inspired by this brief — same kind of location, mood, and architecture. Do not copy or paste onto any reference photograph.",
    "Photograph the model naturally on-location in one coherent exposure that shares the scene's light.",
    "SUBJECT LIGHTING: match the environment's raw ambient light direction, softness, and intensity on face, skin, and hair — not studio softbox/beauty lighting. Keep garment product hue and saturation exact (no scene tint, no oversaturation, no boosted vibrancy); do not invent unrelated colorful gels.",
    closeup
      ? "Close-up: show only heavily defocused bokeh of this environment behind the garment."
      : poseLocked
        ? "Keep the pose reference's exact frame crop and camera distance — full-height stays full-height; tighter stays tighter. Do not invent a different crop to show more or less of the location."
        : "Cast realistic soft contact shadows on floor, steps, or ground. Reframe freely within the same kind of location — any angle that flatters the garment and shot.",
    "Empty scene — no other people. NOT a cutout pasted over a flat backdrop.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Pose image blocks (1334-1378) ----------

/** Labeled block from the stored pose vision brief (POSE / MOOD / CAMERA). */
export function extractPoseLabeledBrief(prompt: string | null | undefined, label: string): string | null {
  const text = String(prompt ?? "").trim();
  if (!text) return null;
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(`(?:^|\\n)${escaped}:\\s*([\\s\\S]*?)(?=\\n(?:WEAR STYLE|POSE|MOOD|CAMERA)\\s*:|$)`, "i"),
  );
  const body = match?.[1]?.trim();
  return body || null;
}

export function poseMatchPromptBlock(poseTag: string): string {
  return [
    `POSE MATCH (hard constraint — overrides vibe, attitude, lifestyle scene desire, accessories display, and any conflicting framing instructions):`,
    `BODY STANCE from ${poseTag} (equal priority with frame — do not invent a catalog default pose):`,
    `- Match exact hand and arm positions (where each hand rests, what it touches, how much of each arm/hand is visible).`,
    `- HAND ANATOMY: every visible arm/hand must be complete and natural — correct shoulders, elbows, wrists; no missing hands, no melted limbs under fabric, no floating jewelry without a real wrist/hand. If ${poseTag} hides hands behind the back, hide them the same way with the same amount of arm/wrist visible — do not invent a broken or half-hidden hand.`,
    `- Match weight distribution, leg stance, hip/shoulder angle, and torso twist.`,
    `- BODY HEIGHT: match ${poseTag}'s tall adult presence — long legs, normal head size. FORBIDDEN: shortening the model, stocky build, oversized head, or compressed legs vs ${poseTag}.`,
    `- Match head turn, head tilt, and gaze/face direction (to camera vs away) — expression mood may follow ${poseTag}, but facial identity, makeup, and hair come from the model/Initial Look.`,
    `FRAME from ${poseTag}: same camera angle, distance, and crop edges — same body coverage and subject-vs-background fill.`,
    `- If ${poseTag} is full-length / head-to-toe, keep full-length with hem and shoes visible — do not crop to waist, mid-thigh, or a tighter portrait.`,
    `- If ${poseTag} is tighter (waist-up, hip, etc.), stay that tight — do not pull back to full-length.`,
    `- Do not zoom in tighter or out wider than ${poseTag}.`,
    `HAIR: ignore ${poseTag}'s hair completely — do not curl, straighten, restyle, recolor, or blend hair from the pose stand-in.`,
    `MAKEUP: ignore ${poseTag}'s makeup completely — keep blush, lipstick, liner, eyeshadow from the model/Initial Look only at natural satin intensity (not dewy/wet highlighter).`,
    `JEWELRY / ACCESSORIES: ignore ${poseTag}'s jewelry completely — never copy bangles, rings, earrings, necklace, maang tikka, belts, or bags from the pose. Accessories come only from the product accessories reference / Initial Look (if any). Keep styling clean and minimal.`,
    `PROPS: only a minimal stance prop if the pose needs physical support (chair/ledge/rail the body leans on). FORBIDDEN: inventing decorative props or jewelry to "style up" the shot.`,
    `Failure cases: different arm/hand placement; broken/missing hands; different stance or weight; shortened/stocky body vs ${poseTag}; oversized head; different head/gaze direction; inventing walk/lean/hands-in-pockets/over-shoulder unless ${poseTag} already shows that; cropping a full-height pose shorter; copying pose jewelry/bangles; inventing extra decorative props; moving hands forward just to show bangles/rings; hair texture/style changing toward the pose person's hair; makeup becoming dewy/glass or changing toward the pose person.`,
    `Use ${poseTag} only for stance, expression mood, angle, and frame — never copy that person's face identity, makeup, skin tone, hair, clothes, jewelry, or background.`,
  ].join("\n");
}

export function poseFrameLockReminder(poseTag: string): string {
  return [
    `FINAL POSE LOCK (hard constraint — wins over scene/lifestyle/accessory/styling instructions above):`,
    `1) BODY: hands, arms, stance, weight, torso angle, head turn, gaze, and tall adult proportions must still match ${poseTag} exactly — anatomically complete limbs, long legs, normal head size; not a shortened/stocky figure, not a relaxed/default catalog pose, and not broken/hidden-wrong hands.`,
    `2) FRAME: match ${poseTag}'s exact body coverage and subject/background ratio. Full-height pose → full-height output (head-to-toe, hem/shoes in frame). Tighter pose → keep that same tighter crop. Never invent a different crop.`,
    `3) HAIR + FACE + MAKEUP: still match the model/Initial Look exactly — never adopt ${poseTag}'s hair (straight↔curly/wavy), hair length, color, face identity, or makeup; keep Initial Look blush/lipstick at natural satin intensity (not dewy/glass).`,
    `4) ACCESSORIES: still ignore ${poseTag}'s jewelry — clean/minimal only; no bangles/rings/earrings copied from the pose stand-in.`,
  ].join("\n");
}

// ---------- buildPrompt (646) ----------

export type BuildPromptInput = {
  pose: { prompt: string; wearStyleNotes: string | null; productCategories: string[] } | null;
  background: PromptBackground;
  notes: string;
  modelAppearanceNotes: string | null;
  isInitial: boolean;
  hasInitialLook: boolean;
  categoryName: string;
  // What the product has uploaded (hasAnySlot / inputImages)
  product: {
    categoryId: string | null;
    hasPairing: boolean;
    hasFootwear: boolean;
    // uploadItemLabel of each uploaded accessory
    uploadedAccessories: string[];
  };
  model: { wearStyleNotes: string | null } | null;
  references: OrigRef[];
  accessories: { name: string }[];
  skinDepthNote: SkinDepthNote | null;
};

export function buildPrompt(shot: PromptShot, input: BuildPromptInput): string {
  const {
    pose,
    background,
    notes,
    modelAppearanceNotes,
    isInitial,
    hasInitialLook,
    product,
    model,
    references,
    accessories = [],
    skinDepthNote = null,
  } = input;
  const garmentContext = { categoryName: input.categoryName };
  const parts: string[] = [];
  const dynamic = isDynamicShot(shot.shotType);
  const isLifestyleShot = shot.shotType === "lifestyle" || shot.shotType === "dynamic_lifestyle";

  const isRearShot =
    shot.shotType === "back" || shot.shotType === "closeup_back" || shot.shotType === "closeup_dynamic_back";

  // 1. SKIN DEPTH LOCK
  const modelTagEarly = imgTag(references, TEMPLATE_VARIABLES.model_image);
  const initialTagEarly = imgTag(references, TEMPLATE_VARIABLES.initial_look);
  const skinIdentityTag = modelTagEarly || initialTagEarly;
  if (skinIdentityTag) {
    const measured = skinDepthNote?.label
      ? `Measured from the model face photo: ${skinDepthNote.label} (Fitzpatrick ${skinDepthNote.fitzpatrick}). `
      : "";
    const darkBias = skinDepthNote?.isDark
      ? " If unsure between two shades, pick the DARKER one — never the fairer. Soft fill must not lift midtones toward fair."
      : "";
    parts.push(
      [
        "SKIN DEPTH LOCK (hard constraint — failure if violated):",
        measured,
        `Match ${skinIdentityTag} melanin depth on face, neck, chest, arms, and hands — output must be the same darkness as the model face photo.`,
        "Keep warm olive undertone. FORBIDDEN: fair-wash, porcelain bleach, beauty-light whitening, blown highlights that lighten, or fake honey-glow brightening. Blush sits on top of true skin depth — pink cheeks ≠ lighter base.",
        darkBias,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  // 2. SESSION CONTINUITY / 3. CANONICAL LOOK
  if (hasInitialLook && !isInitial) {
    const ilTag = initialTagEarly || "the Initial Look photograph";
    parts.push(
      [
        "SESSION CONTINUITY (hard constraint — same person, same session look across EVERY shot):",
        `HEIGHT / BODY: same tall adult proportions as ${ilTag} — same perceived height, leg length, torso length, and head-to-body ratio. Do not grow, shrink, or restock the model between shots.`,
        `MAKEUP: identical to ${ilTag} — same blush amount/color, lipstick/lip tint, liner, eyeshadow, brows, and finish intensity (natural dry-to-satin). Never strip, restyle, or amplify into dewy/glass.`,
        `SKIN TONE: identical melanin depth and warm olive undertone as ${ilTag} (and the model face if present — model wins if IL drifted lighter) on face, neck, chest, arms, hands. Never fairer/darker or differently graded per shot.`,
        `COLOR LOOK: same catalog color grade as ${ilTag} — same garment hue/saturation, same skin color rendering, same white-balance character on the person. No warmer/cooler/punchier/more vivid regrade between shots.`,
        isLifestyleShot
          ? "LIFESTYLE EXCEPTION: discard only the Initial Look's studio softbox/beauty lighting — re-light with environment ambient. Height, makeup, skin tone, garment color, and face identity still match Initial Look exactly."
          : [
              "Only pose and framing may change for this shot.",
              shot.shotType === "side"
                ? "SIDE OVERRIDE: Initial Look is usually front-facing — do NOT keep that front body/face orientation. Use the side pose's camera angle and body silhouette; height/identity/skin/makeup/outfit/color still match Initial Look."
                : isRearShot
                  ? "BACK OVERRIDE: Initial Look is usually front-facing — do NOT keep that front body/face orientation. Use the back pose's rear camera angle and body orientation; height, hair, and any visible face slice still match Initial Look — never invent a different person or copy the pose stand-in's face."
                  : null,
              "STUDIO SET + COLOR LOCK: keep the exact same background wall/floor tone, backdrop color, white balance, and color temperature as the Initial Look — neutral catalog daylight, no added warm/cool/yellow/orange/magenta hue, no golden-hour grade, no re-grading, no different studio plate look.",
              "Match the Initial Look's light direction and softness on face, skin, hair, and garment so the set looks like the same continuous catalog session.",
            ]
              .filter(Boolean)
              .join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else if (isInitial) {
    parts.push(
      "CANONICAL LOOK (this shot defines the pack): lock tall adult height, makeup finish (natural dry-to-satin, not dewy), exact skin tone, and neutral catalog color grade — every later shot must match these exactly.",
    );
  }

  // 4. ROLE MAP
  parts.push(
    roleMapBlock(references, {
      isInitial,
      hasInitialLook,
      backgroundInherited: shot.inheritInitialLookBackground !== false,
      lifestyleBackground: background?.backgroundType === "lifestyle",
    }),
  );

  // 5. FACE + SKIN + MAKEUP + HAIR LOCK
  const modelTag = imgTag(references, TEMPLATE_VARIABLES.model_image);
  const initialFaceTag = imgTag(references, TEMPLATE_VARIABLES.initial_look);
  if (modelTag || initialFaceTag) {
    const hairSource = initialFaceTag ? "the Initial Look photograph" : "the model face reference";
    const identitySource = modelTag ? "the model face reference" : "the Initial Look photograph";
    parts.push(
      [
        "FACE + SKIN + MAKEUP + HAIR LOCK (hard constraint — highest priority for identity):",
        `IDENTITY: same person as ${identitySource} — bone structure, eye shape/spacing, nose, lips, jaw, brows, cheekbones. Not a lookalike or beautified catalog face.`,
        skinDepthNote?.isDark
          ? "SKIN FINISH (dark skin): natural dry-to-satin — visible texture + soft chin/nose shadow. Only very faint forehead/nose specular. FORBIDDEN: dewy, glass skin, oily cheek glow, wet highlighter, soft-glam sheen — those bleach darker skin."
          : "SKIN FINISH: natural dry-to-satin catalog skin — visible texture + soft chin shadow. Only a faint forehead/nose specular if any. FORBIDDEN: dewy, glass skin, oily cheeks, wet highlighter, soft-glam sheen, plastic airbrush.",
        initialFaceTag && modelTag
          ? shot.shotType === "side"
            ? `FACE SPLIT: geometry/skin from ${modelTag}; makeup from ${initialFaceTag}. Side/profile angle from pose — do not front-face just to show IL face. Forbid bare-model makeup or fairer skin.`
            : isRearShot
              ? `FACE SPLIT (rear): geometry/skin from ${modelTag}. Prefer face away; any visible face slice matches ${modelTag}, never pose stand-in. Makeup from ${initialFaceTag} only if visible.`
              : `FACE SPLIT: geometry/skin depth from ${modelTag} (wins if IL drifted lighter); makeup ONLY from ${initialFaceTag}. If they disagree: makeup→IL, skin depth→model. Keep makeup intensity natural — do not amplify highlighter into dewy glass skin.`
          : initialFaceTag
            ? shot.shotType === "side"
              ? "FACE + MAKEUP CONTINUITY: same person/skin/makeup as Initial Look at side/profile angle — do not keep front-facing IL head just to match that crop."
              : isRearShot
                ? "FACE CONTINUITY (rear): same person/skin/hair as Initial Look; face preferably away. Any visible face slice matches IL — never invent or copy pose stand-in."
                : "FACE + MAKEUP CONTINUITY: crop of Initial Look person — same geometry, melanin depth, and makeup (blush/lipstick/liner/shadow — natural satin, not dewy). Forbid fair-wash, stripped, or prettier/fairer catalog face."
            : `FACE TRANSFER from ${modelTag}: same person — geometry, dusky/dark skin depth with warm olive undertone, makeup as photographed (natural satin, not dewy). Soft natural expression. Failure if different or fairer face.`,
        `HAIR from ${hairSource}: exact length/color/texture/style — never restyle from pose.`,
        "No beautify/reshape/lighten. Ethnicity and structure exact.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  // 6. BODY PROPORTION LOCK
  // Keep height consistent across the pack — Initial Look is ground truth when present.
  if (
    isInitial ||
    isLifestyleShot ||
    shot.shotType === "front" ||
    shot.shotType === "front_full_sleeve" ||
    shot.shotType === "side" ||
    shot.shotType === "back" ||
    shot.shotType === "initial"
  ) {
    const posePropTag = imgTag(references, TEMPLATE_VARIABLES.pose_image);
    const ilPropTag = imgTag(references, TEMPLATE_VARIABLES.initial_look);
    parts.push(
      [
        "BODY PROPORTION LOCK (hard constraint — failure if violated):",
        "Tall adult ethnic-catalog proportions — elongated legs, slim torso, normal adult head-to-body ratio (~1:7–1:8).",
        ilPropTag && !isInitial
          ? `HEIGHT GROUND TRUTH: match ${ilPropTag}'s exact perceived height, leg length, and head size — same person standing at the same height in every shot. Pose may change stance/crop, but must not shrink or grow the body.`
          : posePropTag
            ? `Match ${posePropTag}'s height presence and leg length in frame — if that pose reads tall/full-length, output must look equally tall.`
            : "Full-length head-to-toe with generous leg length visible — hem and shoes in frame.",
        "FORBIDDEN: short/stocky build, oversized head, childlike proportions, compressed legs, or a crop that makes the model look shorter than Initial Look / pose.",
      ].join(" "),
    );
  }

  // 7. Pose (image) blocks — only when the pose is sent as an image
  const poseTag = imgTag(references, TEMPLATE_VARIABLES.pose_image);
  if (poseTag && !dynamic) {
    parts.push(poseMatchPromptBlock(poseTag));
    const stanceBrief = extractPoseLabeledBrief(pose?.prompt, "POSE");
    if (stanceBrief) {
      parts.push(`POSE STANCE BRIEF (hard constraint — match body from ${poseTag}):\n${stanceBrief}`);
    }
    const moodBrief = extractPoseLabeledBrief(pose?.prompt, "MOOD");
    if (moodBrief) {
      parts.push(
        `POSE MOOD BRIEF (expression from ${poseTag} — hard constraint, apply on the locked face identity):\n${moodBrief}\nIf this brief calls for a soft smile / warm / pleasant expression, the output MUST show that — not a blank neutral stock stare. Expression mood from pose; face identity and skin depth still from model/Initial Look.`,
      );
    }
    const cameraBrief = extractPoseLabeledBrief(pose?.prompt, "CAMERA");
    if (cameraBrief) {
      parts.push(`POSE FRAME BRIEF (hard constraint — lock crop to ${poseTag}):\n${cameraBrief}`);
    }
  }
  if (hasInitialLook && !isInitial && poseTag) {
    const identityFrom =
      modelTag && initialFaceTag
        ? "model face reference (geometry/skin) + Initial Look (makeup/hair)"
        : "Initial Look";
    parts.push(
      shot.shotType === "side"
        ? `POSE IDENTITY LOCK (hard constraint): the pose photo is a different person used ONLY for body stance, hands, head turn, camera angle (true side/profile), and frame. Never copy their face/skin/makeup/hair/clothes/jewelry/accessories — identity and makeup come from ${identityFrom}, but body orientation and camera angle must stay side/profile from the pose (do not front-face to match Initial Look).`
        : isRearShot
          ? `POSE IDENTITY LOCK (hard constraint): the pose photo is a different person used ONLY for body stance, hands, amount of head turn away from camera, camera angle (true rear), and frame. Match HOW MUCH the head is turned — not their face features, hairline, ear shape, or skin. Never copy their face/skin/makeup/hair/clothes/jewelry/accessories — identity comes from ${identityFrom}. Do not front-face to show Initial Look, and do not invent a different rear-facing face.`
          : `POSE IDENTITY LOCK (hard constraint): the person in the pose photo is a different, unrelated stand-in used ONLY for body stance, hand/arm positions, head turn, camera angle, and frame composition. Treat their face identity, skin tone, makeup, hair (texture/style/length/color — curly vs straight etc.), clothing, and jewelry/accessories (bangles, rings, earrings, necklace, bags) as invisible — copying or blending any of it is a failure. The output's face, makeup, skin, hair, and outfit must come from ${identityFrom}.`,
    );
  }
  if (isInitial && poseTag && modelTag) {
    parts.push(
      "POSE IDENTITY LOCK (hard constraint): the pose photo is a different person used ONLY for body stance, hands, head turn, camera angle, and frame. Never copy their hair, face, makeup, skin, clothes, or jewelry/accessories — hair, face, and makeup identity come only from the model face reference.",
    );
  }

  // 8. SHOT + SHOT GUARD
  const template = resolveTemplateVariables(shot.promptTemplate ?? "", references).trim();
  if (template) {
    parts.push(`SHOT:\n${template}`);
    parts.push(
      "SHOT GUARD: attitude/vibe words in SHOT (sultry, swag, editorial, etc.) must NOT change face identity, skin depth, or invent beauty makeup — those stay locked to the model face reference.",
    );
  }

  // 9. ACCESSORIES
  if (accessories.length || product.uploadedAccessories.length) {
    const accessoriesSent = Boolean(imgTag(references, TEMPLATE_VARIABLES.accessories_image));
    if (accessoriesSent) {
      const lines = [
        "ACCESSORIES (from the accessories reference image ONLY — never from the pose photo):",
        "Wear these catalog accessories if visible in this frame. Do NOT move hands/arms or change the pose to display jewelry. If the pose hides hands/wrists, keep them hidden — omit or partially hide accessories that would not be visible. Never add bangles/rings/earrings from the pose stand-in.",
      ];
      for (const a of accessories) {
        lines.push(`- ${a.name}`);
      }
      for (const label of product.uploadedAccessories) {
        lines.push(`- uploaded ${label}`);
      }
      parts.push(lines.join("\n"));
    } else if (hasInitialLook && !isInitial) {
      parts.push(
        "ACCESSORIES (same as Initial Look): keep only the accessories already on the Initial Look photograph — do not invent, omit, or substitute different ones, and never pull jewelry/bangles from the pose photo.",
      );
    }
  }
  if (poseTag) {
    parts.push(
      "POSE ACCESSORIES FORBIDDEN (studio + lifestyle): ignore all jewelry and worn accessories on the pose stand-in — no bangles, rings, earrings, necklace, maang tikka, belts, bags, or similar. Keep the look clean and minimal. Only a minimal stance prop may be used if the body pose itself requires it (e.g. lean on a chair/ledge) — never decorative jewelry props that exaggerate styling.",
    );
  }

  // 10. PAIRING / PAIRING LAYERING / FOOTWEAR
  const pairingSentThisShot = Boolean(imgTag(references, TEMPLATE_VARIABLES.pairing_image));
  const footwearSentThisShot = Boolean(imgTag(references, TEMPLATE_VARIABLES.footwear_image));
  if (hasInitialLook && !isInitial && !pairingSentThisShot && product.hasPairing) {
    parts.push(
      "PAIRING (same as Initial Look): keep every pairing item (inner layer, bottomwear, dupatta, etc.) exactly as shown in the Initial Look photograph — do not alter color, print, fabric, or fit, and do not invent, drop, or substitute any.",
    );
  }
  if (pairingSentThisShot) {
    parts.push(
      "PAIRING LAYERING: the product garment stays the hero piece. Wear every pairing item with it in its natural position — inner layers (t-shirt/shirt/camisole) underneath and visible where the product opens (neckline, hem, cuffs, open front), bottomwear on the lower body, dupatta/stole draped. Follow each item's label when given.",
    );
  }
  if (hasInitialLook && !isInitial && !footwearSentThisShot && product.hasFootwear) {
    parts.push(
      "FOOTWEAR (same as Initial Look): keep the exact footwear shown in the Initial Look photograph — do not invent or substitute a different pair.",
    );
  }

  // 11. STYLING + STYLING GUARD (initial look only)
  if (modelAppearanceNotes?.trim() && isInitial) {
    parts.push(
      [
        "STYLING (secondary — body proportions / garment vibe only — NEVER override face, skin depth, or makeup from the model face photo):",
        modelAppearanceNotes.trim(),
        "STYLING GUARD: ignore any STYLING words like supermodel, dewy, soft glam, glass skin, fair, glowing, luminous, or perfect that would redesign the face, add wet highlighter, or lighten skin. Face geometry, melanin depth, and makeup finish come ONLY from the model face reference — natural dry-to-satin, never dewy. Tall/elongated body proportion words in STYLING MAY apply to height/legs only.",
      ].join("\n"),
    );
  }

  // 12. SHOT PURPOSE / framing, then POSE (text)
  const garmentTag =
    imgTag(references, (r) => r?.role === "garment" && !isExtraGarmentAngle(r)) ||
    imgTag(references, (r) => r?.role === "garment");
  const purpose = shotPurposeLine(shot.shotType);
  if (purpose) parts.push(purpose);
  const framing = shotFramingLine(shot.shotType, garmentTag, poseTag);
  if (framing) parts.push(framing);

  if (!dynamic && pose?.prompt?.trim() && !imgTag(references, TEMPLATE_VARIABLES.pose_image)) {
    parts.push(`POSE (text):\n${pose.prompt.trim()}`);
  }

  // 13. WEAR STYLE LOCK (initial look only, ethnic categories only)
  if (isInitial) {
    const categoryName = garmentContext?.categoryName;
    if (pose && wearStyleApplies(pose, product, categoryName)) {
      parts.push(wearStylePromptBlock(pose.wearStyleNotes ?? ""));
    } else if (
      model?.wearStyleNotes?.trim() &&
      wearStyleApplies({ wearStyleNotes: model.wearStyleNotes, productCategories: [] }, product, categoryName)
    ) {
      parts.push(wearStylePromptBlock(model.wearStyleNotes));
    }
  }

  // 14. DYNAMIC
  if (dynamic) {
    parts.push(
      [
        isDynamicCloseupShot(shot.shotType)
          ? "DYNAMIC: invent a bold, editorial close-up — runway/campaign energy (Lakme Fashion Week backstage / aura-shot attitude), any unique angle or pose the shot calls for. Do not copy any reference pose."
          : "DYNAMIC: invent a fresh pose/camera for this shot.",
        "Keep the Initial Look face, makeup look, outfit, and mood/expression exactly.",
        shot.shotType === "dynamic_lifestyle"
          ? background
            ? "Recreate a fresh nearby scene inspired by the specified background's mood and location — do not copy the exact plate. Keep garment hero-sharp with exact product color."
            : "You may change environment; keep garment hero-sharp with exact product color."
          : "Keep the same studio background as Initial Look.",
      ].join(" "),
    );
  }

  // 15. Lighting
  const bgTag = imgTag(references, TEMPLATE_VARIABLES.background);
  if (isLifestyleShot) {
    parts.push(lifestyleLightingPromptLine());
  } else {
    parts.push(
      studioIntegrationPromptLine({
        matchInitialLook: Boolean(hasInitialLook && !isInitial),
        darkSkin: Boolean(skinDepthNote?.isDark),
      }),
    );
  }
  if (bgTag) {
    parts.push(
      background?.backgroundType === "lifestyle"
        ? [
            `SCENE RECREATION (hard constraint — ${bgTag} is REFERENCE ONLY):`,
            `Use ${bgTag} only as inspiration for location type, architecture, palette, and real-world lighting.`,
            "Invent a fresh nearby/similar environment — same kind of place, different exact layout, props, and camera vantage. Do NOT paste, clone, pixel-match, or composite the person onto this plate.",
            "SUBJECT LIGHTING (critical — this is what fails paste detection): light the person ONLY with the recreated environment's raw ambient light — windows, sky, practicals, bounce from walls/floor. Same direction, softness, intensity, and color temperature on face, skin, hair, AND garment.",
            "HIGHLIGHTS (minimal, environment-driven): at most a faint forehead/nose specular and subtle fabric sheen where scene light hits — natural dry-to-satin skin, NOT dewy/glass/oily. No blown face highlights, no beauty-dish glare, no wet cheek highlighter.",
            "FORBIDDEN on the person: studio softbox/beauty dish, hard catalog key+fill+rim, flat front beauty light, or any leftover Initial Look studio lighting. If the face/garment still look studio-lit while the room looks environmental, the shot has failed.",
            "Photograph as one real on-location DSLR exposure: shared perspective, soft contact shadows/occlusion, natural edge light wrap from the environment.",
            "Minimal optical separation only — environment stays mostly sharp and readable; avoid heavy blur, creamy bokeh, or milky haze. Not a razor-sharp cutout. Avoid halo/matte edges, floating feet, or any photoshopped look.",
            poseTag && !dynamic
              ? `FRAME LOCK: match ${poseTag}'s exact camera distance and body coverage — if ${poseTag} is full-length/head-to-toe, keep full-length (hem and shoes visible); if it is tighter, stay that tight. Do not invent a different crop to show more or less of the reference room.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")
        : [
            `NATURAL STUDIO (hard constraint): Person photographed IN ${bgTag} as one real studio exposure — not layered or masked onto the plate.`,
            hasInitialLook && !isInitial
              ? `Match the Initial Look's exact studio light recipe and backdrop color through ${bgTag} — same key/fill/rim direction, intensity, white balance, and color temperature on face, skin, hair, and garment. No yellow/orange warm cast vs Initial Look. Keep face exposure and makeup finish identical to Initial Look — do not add beauty-light fill, and do not strip or restyle blush/lipstick/highlighter.`
              : `Match ${bgTag}'s key/fill/rim direction, intensity, and neutral daylight color temperature on face, skin, hair, and garment (bounce and soft shadows must agree with the set). No warm yellow/orange grade on the wall/backdrop — keep the model face photo's skin undertone and melanin depth.`,
            hasInitialLook && !isInitial
              ? "LIGHTING HIGHLIGHTS: soft naturalistic face modeling matching Initial Look — gentle specular on forehead, nose bridge, cheekbones for real-photo depth; faint fabric sheen on folds/embroidery. Keep makeup blush/lipstick/highlighter. FORBIDDEN: blown/overexposed face highlights, oily beauty-dish glare, or flat matte beauty that removes dimension."
              : skinDepthNote?.isDark
                ? "LIGHTING HIGHLIGHTS (dark skin): keep soft chin/nose shadow for depth; only a VERY faint specular on forehead/nose bridge. Strong cheek glare fair-washes darker skin — avoid it. Faint fabric sheen on garment folds. FORBIDDEN: blown highlights, oily beauty-dish glare, porcelain glass-skin."
                : "LIGHTING HIGHLIGHTS: soft naturalistic face modeling for realism — gentle specular kiss on forehead, nose bridge, and cheekbones, soft shadow under chin/nose, plus faint fabric sheen on garment folds. Skin must look photographed (dimensional), not flat or airbrushed. FORBIDDEN: blown highlights that bleach darker skin, oily beauty-dish glare, porcelain glass-skin.",
            "Slight optical depth of field — subject tack-sharp, studio backdrop gently softer — real camera look, not a paste.",
            "Minimal natural floor contact — a very light, soft shadow under feet/hem only (barely-there grounding). No heavy, dark, long, or dramatic shadows. Soft edge light wrap; no hard matte edges, halos, or floating feet.",
            poseTag && !dynamic
              ? `FRAME LOCK: match ${poseTag}'s exact camera distance and body coverage — if ${poseTag} is full-length/head-to-toe, keep full-length (hem and shoes visible); if it is tighter, stay that tight. Do not invent a different crop.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
    );
  }

  // 16. Background notes
  // Stored background prompt — always applied when present (plate and/or text).
  if (!dynamic) {
    const bgBlock = backgroundScenePromptBlock(background, shot.shotType, {
      poseLocked: Boolean(poseTag),
    });
    if (bgBlock) parts.push(bgBlock);
  }

  // 17. Product notes
  if (notes?.trim()) {
    parts.push(`Product notes: ${notes.trim()}`);
  }

  // 18. GARMENT FIT
  const garmentToken = garmentTag || (hasInitialLook ? imgTag(references, TEMPLATE_VARIABLES.initial_look) : null);
  const restyleBlouse = isInitial && stylingAllowsBlouseChange(modelAppearanceNotes);
  parts.push(
    garmentFitDirection(garmentContext?.categoryName, garmentToken, {
      lockBlouseToProduct: isInitial && !restyleBlouse,
      restyleBlouse,
      poseLocked: Boolean(poseTag) && !dynamic,
    }),
  );

  // 19. Finish + Rendering
  parts.push(
    isLifestyleShot
      ? "Finish: pressed fabric, exact product hue and saturation matching Initial Look — lit by the environment's raw ambient light (not studio/neutral beauty light). Same skin tone and makeup as Initial Look. Do not brighten, punch up, or oversaturate garment colors."
      : hasInitialLook && !isInitial
        ? "Finish: pressed fabric, exact product color — same neutral white balance, backdrop tone, skin tone, makeup, and height as the Initial Look (no yellow/orange warm cast on wall/floor/garment, no added hue or grade). Face identity stays identical to Initial Look."
        : skinDepthNote?.isDark
          ? "Finish: pressed fabric, exact product color, neutral catalog daylight white balance on backdrop and garment. SKIN: face/neck/hands must match measured model face darkness — medium-dark/dusky/dark stays that dark (never fairer). Soft fill must not lift skin midtones."
          : "Finish: pressed fabric, exact product color, neutral catalog daylight white balance on backdrop and garment — no yellow/orange warm cast on wall or floor. SKIN DEPTH: face/neck/hands locked to the model face reference melanin depth — if the headshot is dark/dusky, output stays dark/dusky (never fairer, brighter, or more golden).",
  );
  parts.push(
    isLifestyleShot
      ? "Rendering: natural on-location look — same dry-to-satin skin, makeup, skin tone, height, and garment color as Initial Look (not dewy, not regraded). No OLED punch/oversaturation."
      : hasInitialLook && !isInitial
        ? "Rendering: match Initial Look catalog grade exactly — same color look, same makeup at natural satin intensity (not more dewy), same skin tone, same height/proportions. Soft face modeling without wet highlighter. Backdrop WB same as IL. Face geometry/skin from model face when present; makeup/hair from IL. No fair-wash, no oversaturation, no OLED punch."
        : skinDepthNote?.isDark
          ? `Rendering: clean catalog look — true-to-life color, neutral backdrop WB. Exact face + skin from model face: ${skinDepthNote.label}. Keep that darkness on face/neck/hands; soft natural expression; dry-to-satin finish only (no dewy/glass). Forbid fair-wash, oversaturation, OLED punch, flat airbrush.`
          : "Rendering: clean catalog look — true-to-life color, neutral backdrop WB, natural dry-to-satin skin (faint forehead/nose specular only — not dewy cheeks). Exact face + melanin depth from model face (dark/dusky stays dark, warm olive). Soft natural expression. Tall adult proportions. Forbid dewy/glass skin, blown highlights that lighten, fair-wash, flat airbrush, oversaturation, OLED punch.",
  );

  // 20. Reference quality
  if (isLifestyleShot) {
    parts.push(
      "LIFESTYLE COLOR FIDELITY: exact {{garment_image}} / Initial Look garment hue and saturation — not brighter/more vivid. Same skin tone and makeup as Initial Look. No oversaturation or jewel-shift.",
      "GARMENT DETAILS: every zipper, logo, badge, patch, label, button, buckle, drawstring, piping, and trim must match the product photos exactly — same position, size, shape, color, finish (metal/plastic/fabric), and logo artwork/text. Do not add, remove, move, mirror, recolor, or redraw any of them.",
    );
  } else {
    parts.push(
      referenceOutputQuality(shot.shotType, {
        isInitialLook: Boolean(isInitial),
        dynamic,
      }),
    );
  }

  if (poseTag && !dynamic) {
    parts.push(poseFrameLockReminder(poseTag));
  }

  // 21. GARMENT COLOR — DO NOT CHANGE
  parts.push(
    `GARMENT COLOR — DO NOT CHANGE (hard constraint): the garment's own color never changes from ${garmentToken || "the garment reference"}. Do not recolor it, do not make it lighter or darker, do not shift it toward any other hue, even to "match" the background, skin tone, or scene mood. The ONLY thing allowed to vary with the scene is how light falls on it — natural highlight and shadow from the light source, exactly as it would on a real garment of that exact color in that exact light. That is not a color change; the fabric's base color underneath the light and shadow stays pixel-identical to the reference. If the fabric is dark-wash, deep-toned, or near-black, it must still read as dark-wash, deep-toned, or near-black after lighting is applied — never softened into a mid-tone or faded look.`,
  );

  return (
    bindReferencePlaceholders(parts.join("\n\n"), references) ||
    "Generate a catalog fashion photograph of the garment on the model."
  );
}

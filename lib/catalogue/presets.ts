// --------------------------------------------------
// CATALOGUE: built-in starter library (pure data)
//
// Text-only presets seeded into catalogueAssets /
// catalogueTemplates. Poses are POSE / MOOD / CAMERA
// briefs in the format of the source engine's
// pose-to-prompt instruction; shot prompts follow its
// shot types and benchmarks.
// --------------------------------------------------

import type { AssetKind, Gender, ShotDefinition } from "./shared";

export type PresetAsset = {
  key: string;
  kind: AssetKind;
  name: string;
  prompt: string;
  notes: string;
  gender: Gender | null;
  setting: "studio" | "lifestyle" | null;
};

export type PresetShot = Omit<ShotDefinition, "poseId" | "backgroundId"> & {
  poseKey: string | null;
  backgroundKey: string | null;
};

export type PresetTemplate = {
  key: string;
  name: string;
  description: string;
  styling: string;
  categories: string[];
  shots: PresetShot[];
};

const model = (key: string, name: string, gender: Gender, prompt: string, notes: string): PresetAsset => ({
  key,
  kind: "model",
  name,
  prompt,
  notes,
  gender,
  setting: null,
});

const pose = (key: string, name: string, prompt: string, gender: Gender | null = null): PresetAsset => ({
  key,
  kind: "pose",
  name,
  prompt,
  notes: "",
  gender,
  setting: null,
});

const background = (key: string, name: string, setting: "studio" | "lifestyle", prompt: string): PresetAsset => ({
  key,
  kind: "background",
  name,
  prompt,
  notes: "",
  gender: null,
  setting,
});

const accessory = (key: string, name: string, prompt: string): PresetAsset => ({
  key,
  kind: "accessory",
  name,
  prompt,
  notes: "",
  gender: null,
  setting: null,
});

export const PRESET_ASSETS: PresetAsset[] = [
  // ---------- Models (text-only personas) ----------
  model(
    "model-ananya",
    "Ananya",
    "female",
    "Indian woman, mid-20s, tall and slim, warm medium-brown skin with olive undertone, long straight dark-brown hair, soft oval face, natural dry-to-satin makeup.",
    "Wears clothes neatly and true to size; ethnic sets pressed and well draped, western wear relaxed but tidy.",
  ),
  model(
    "model-meera",
    "Meera",
    "female",
    "Indian woman, late 30s, graceful medium build, dusky deep-brown skin with warm undertone, shoulder-length wavy black hair, elegant minimal makeup.",
    "Classic, polished styling; sarees draped with neat pleats and a smooth pallu.",
  ),
  model(
    "model-arjun",
    "Arjun",
    "male",
    "Indian man, late 20s, tall athletic build, medium-brown skin, short neatly styled black hair, light trimmed beard, confident relaxed expression.",
    "Shirts tucked or untucked as the garment is designed; sleeves at full length unless styling says otherwise.",
  ),
  model(
    "model-kabir",
    "Kabir",
    "male",
    "Indian man, early 40s, tall with a solid build, wheatish skin, short salt-and-pepper hair, clean-shaven, calm mature expression.",
    "Smart, understated fit; kurtas and jackets worn straight and pressed.",
  ),
  model(
    "model-sofia",
    "Sofia",
    "female",
    "European woman, mid-20s, tall and slim, light olive skin, long light-brown hair in soft waves, fresh natural makeup.",
    "Contemporary western styling, relaxed and effortless.",
  ),
  model(
    "model-daniel",
    "Daniel",
    "male",
    "Black man, late 20s, tall and lean, deep brown skin, short cropped hair, clean-shaven, friendly expression.",
    "Streetwear and casual fits worn true to their volume — oversized stays oversized.",
  ),

  // ---------- Poses (POSE / MOOD / CAMERA briefs) ----------
  pose(
    "pose-front-standing",
    "Front standing",
    "POSE:\nWeight evenly on both legs, feet hip-width apart. Both arms relaxed at the sides, hands loose. Hips and shoulders square to camera. Head straight, eyes to camera.\n\nMOOD:\nConfident, soft-warm. Soft closed smile, relaxed brows, calm gaze.\n\nCAMERA:\nFull body head to toe with headroom and floor margin, subject centered. Eye-level, straight-on, level horizon. Medium catalog lens feel.",
  ),
  pose(
    "pose-three-quarter",
    "Three-quarter turn",
    "POSE:\nWeight on the back leg, front knee slightly bent. Body turned slight 3-4 left; shoulders follow the hips. Near arm relaxed at the side, far hand resting lightly on the hip. Head turned back toward camera, eyes to camera.\n\nMOOD:\nConfident, poised. Soft closed smile.\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, level horizon. Medium catalog lens feel.",
  ),
  pose(
    "pose-back-view",
    "Back view",
    "POSE:\nWeight evenly on both legs. Back fully to camera; hips and shoulders square away from camera. Arms relaxed at the sides, hands visible beside the hips. Head straight, facing away — face not visible.\n\nMOOD:\nNeutral / reserved (face not visible).\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, straight-on to the back, level horizon.",
  ),
  pose(
    "pose-side-profile",
    "Side profile",
    "POSE:\nWeight on the far leg, near leg straight. Body in full profile to camera (facing right of frame). Near arm relaxed at the side, slightly behind the hip so the silhouette stays clear. Head in profile, eyes looking ahead, not at camera.\n\nMOOD:\nSerene, reserved. Closed mouth, relaxed brows.\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, profile yaw, level horizon.",
  ),
  pose(
    "pose-walking",
    "Walking",
    "POSE:\nMid-stride toward camera: left leg forward, weight transferring onto it, right heel lifting. Arms swinging naturally and opposite to the legs. Hips and shoulders front, slight natural twist. Head up, eyes to camera.\n\nMOOD:\nConfident, bright commercial. Soft open smile.\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, straight-on, level horizon. Medium lens feel.",
  ),
  pose(
    "pose-seated",
    "Seated",
    "POSE:\nSeated upright on a simple stool, weight centered. Knees together and angled slight 3-4 right, feet on the floor. Hands resting lightly on the thighs. Shoulders relaxed, torso straight. Head slightly tilted, eyes to camera.\n\nMOOD:\nSoft-warm, relaxed. Soft closed smile.\n\nCAMERA:\nFull seated body head to feet with margin, subject centered. Camera slightly below eye-level, straight-on, level horizon.",
  ),
  pose(
    "pose-hand-in-pocket",
    "Hand in pocket",
    "POSE:\nWeight on the right leg, left leg relaxed and slightly forward. Right hand in the trouser/garment pocket up to the knuckles; left arm relaxed at the side. Hips slight 3-4 right, shoulders square to camera. Head straight, eyes to camera.\n\nMOOD:\nConfident, casual. Closed relaxed smile.\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, level horizon.",
  ),
  pose(
    "pose-closeup-front",
    "Close-up crop",
    "POSE:\nWeight even, shoulders square to camera. Arms relaxed at the sides, hands out of frame or resting naturally. Head straight, eyes to camera or slightly down.\n\nMOOD:\nCalm, neutral-warm. Closed soft mouth.\n\nCAMERA:\nTight crop from collarbone to just below the garment's hem — the garment fills most of the frame. Eye-level, straight-on, level horizon. Tight portrait lens feel.",
  ),
  pose(
    "pose-over-shoulder",
    "Over-shoulder glance",
    "POSE:\nWeight on the left leg. Back mostly to camera, shoulders slight 3-4 left. Arms relaxed at the sides. Head turned over the right shoulder in a small glance — only a sliver of the face visible.\n\nMOOD:\nPlayful, soft-warm. Soft closed smile.\n\nCAMERA:\nFull body head to toe with margin, subject centered. Eye-level, level horizon.",
  ),
  pose(
    "pose-lean-casual",
    "Casual lean",
    "POSE:\nLeaning lightly with one shoulder against a wall, weight on the outer leg, inner ankle crossed in front. Arms loosely folded at waist height, wrists visible. Body slight 3-4 to camera. Head tilted toward the wall, eyes to camera.\n\nMOOD:\nRelaxed, confident. Soft open smile.\n\nCAMERA:\nFull body head to toe with margin, subject slightly left of center. Eye-level, level horizon. Medium lens feel.",
  ),

  // ---------- Backgrounds ----------
  background(
    "bg-white-studio",
    "White seamless studio",
    "studio",
    "Pure white seamless studio backdrop and floor (cyclorama), evenly lit, no visible horizon line, neutral daylight color temperature.",
  ),
  background(
    "bg-grey-studio",
    "Light grey studio",
    "studio",
    "Light neutral-grey seamless studio backdrop, smooth and even, soft gradient toward the floor, neutral daylight.",
  ),
  background(
    "bg-beige-studio",
    "Warm beige studio",
    "studio",
    "Warm beige / sand seamless studio backdrop, soft and even; warmth stays in the backdrop only — no warm cast on the garment or skin.",
  ),
  background(
    "bg-urban-street",
    "Urban street",
    "lifestyle",
    "Clean modern city street in daylight — light stone pavement, muted shopfronts and architecture softly behind, overcast even light, no crowds.",
  ),
  background(
    "bg-cafe",
    "Café",
    "lifestyle",
    "Bright, airy café interior — wooden tables, plants and large windows with soft natural daylight, calm and uncluttered, no other people.",
  ),
  background(
    "bg-garden",
    "Outdoor garden",
    "lifestyle",
    "Lush outdoor garden path — green foliage, flowering shrubs and a light stone walkway, soft open-shade daylight.",
  ),

  // ---------- Accessories ----------
  accessory(
    "acc-gold-jhumkas",
    "Gold jhumka earrings",
    "Small traditional gold jhumka earrings, matte-polished, worn on both ears.",
  ),
  accessory(
    "acc-leather-watch",
    "Leather strap watch",
    "Minimal analog watch with a slim brown leather strap, worn on the left wrist.",
  ),
  accessory(
    "acc-sunglasses",
    "Black sunglasses",
    "Classic black-framed sunglasses, worn on the face or tucked at the neckline.",
  ),
];

// Shot prompts (from the source's shot types / benchmarks)
const SHOT = {
  initial:
    "Full-length hero look shot of the {{gender}} model wearing the {{product}} ({{category}}) — complete outfit head-to-toe with margin, confident natural catalog pose, neutral daylight studio light, pressed fabric, sharp print and embroidery.",
  front:
    "Full-length studio portrait head-to-toe, straight-on — exact garment color, complete outfit uncropped, pressed fabric, sharp print and embroidery, confident catalog pose.",
  back: "Full-length true rear view of the {{product}} — back panel, seams, closures and hem sharp and pressed, toward the camera. Face away / not readable.",
  side: "Full-length side-profile studio portrait — the {{product}}'s silhouette and drape clearly readable from the side, pressed fabric, sharp detail.",
  detail:
    "Extreme close-up of the {{product}} — collarbone to hem fills 85%+ of the frame. Macro-clean fabric texture, print, embroidery, neckline and trims. No full body, no feet.",
  closeup:
    "Waist-up close-up of the model in the {{product}} — focus on the texture, fabric and key details (buttons, collar, stitching), background softly blurred.",
  lifestyle:
    "Candid, atmospheric lifestyle shot of the {{gender}} model in the {{product}} — a natural, unposed moment in the setting, effortlessly chic and authentic. Garment hero-sharp and true to color.",
};

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    key: "tpl-ecommerce-standard",
    name: "E-commerce standard",
    description: "The balanced marketplace set: hero look, front, back, side, detail close-up and one lifestyle shot.",
    styling: "Clean, modern e-commerce styling — minimal, true-to-size fit, nothing that distracts from the garment.",
    categories: ["Top wear", "Shirts", "T-shirts", "Dresses", "Bottoms", "Co-ords", "Outerwear", "Activewear"],
    shots: [
      { id: "initial", label: "Initial look", type: "initial", prompt: SHOT.initial, poseKey: "pose-three-quarter", backgroundKey: "bg-white-studio" },
      { id: "front", label: "Front", type: "front", prompt: SHOT.front, poseKey: "pose-front-standing", backgroundKey: null },
      { id: "back", label: "Back", type: "back", prompt: SHOT.back, poseKey: "pose-back-view", backgroundKey: null },
      { id: "side", label: "Side", type: "side", prompt: SHOT.side, poseKey: "pose-side-profile", backgroundKey: null },
      { id: "detail", label: "Detail close-up", type: "detail", prompt: SHOT.detail, poseKey: "pose-closeup-front", backgroundKey: null },
      { id: "lifestyle", label: "Lifestyle", type: "lifestyle", prompt: SHOT.lifestyle, poseKey: "pose-walking", backgroundKey: "bg-urban-street" },
    ],
  },
  {
    key: "tpl-ethnic-wear",
    name: "Ethnic wear",
    description: "For kurtas, sets and sarees: warm studio hero, front, back, side, embroidery close-up and a garden lifestyle shot.",
    styling:
      "Elegant Indian ethnic styling — freshly steamed and pressed fabric, neat drape, minimal traditional jewellery only if it suits the garment. No extra dupatta unless it is part of the product.",
    categories: ["Ethnic wear", "Sarees", "Co-ords"],
    shots: [
      { id: "initial", label: "Initial look", type: "initial", prompt: SHOT.initial, poseKey: "pose-front-standing", backgroundKey: "bg-beige-studio" },
      { id: "front", label: "Front", type: "front", prompt: SHOT.front, poseKey: "pose-three-quarter", backgroundKey: null },
      { id: "back", label: "Back", type: "back", prompt: SHOT.back, poseKey: "pose-over-shoulder", backgroundKey: null },
      { id: "side", label: "Side", type: "side", prompt: SHOT.side, poseKey: "pose-side-profile", backgroundKey: null },
      {
        id: "detail",
        label: "Embroidery close-up",
        type: "detail",
        prompt: `${SHOT.detail} Every stitch and border motif crisp.`,
        poseKey: "pose-closeup-front",
        backgroundKey: null,
      },
      { id: "lifestyle", label: "Lifestyle", type: "lifestyle", prompt: SHOT.lifestyle, poseKey: "pose-seated", backgroundKey: "bg-garden" },
    ],
  },
  {
    key: "tpl-quick-3",
    name: "Quick 3-shot",
    description: "The minimum listing set: hero look, back and a close-up.",
    styling: "Clean, simple catalog styling.",
    categories: [],
    shots: [
      { id: "initial", label: "Initial look", type: "initial", prompt: SHOT.initial, poseKey: "pose-front-standing", backgroundKey: "bg-grey-studio" },
      { id: "back", label: "Back", type: "back", prompt: SHOT.back, poseKey: "pose-back-view", backgroundKey: null },
      { id: "closeup", label: "Close-up", type: "closeup", prompt: SHOT.closeup, poseKey: null, backgroundKey: null },
    ],
  },
];

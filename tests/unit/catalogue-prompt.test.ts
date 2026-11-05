import { describe, expect, it } from "vitest";
import { PRESET_ASSETS, PRESET_TEMPLATES } from "@/lib/catalogue/presets";
import {
  CORRECTION_HEADING,
  ORIGINAL_SHOT_TYPES,
  OUTPUT_SHARPNESS,
  PROMPT_MAX_CHARS,
  buildShotRequest,
  missingGarmentRoles,
  originalShotType,
  pickReferences,
  type PromptContext,
  type Reference,
} from "@/lib/catalogue/prompt";
import { ASSET_KINDS, MAX_SHOTS, SHOT_TYPES, type PublicAsset, type ShotDefinition } from "@/lib/catalogue/shared";

const asset = (kind: PublicAsset["kind"], prompt: string, extra: Partial<PublicAsset> = {}): PublicAsset => ({
  id: `${kind}-1`,
  kind,
  name: `${kind} name`,
  prompt,
  notes: "",
  gender: null,
  setting: null,
  imageUrl: null,
  status: "active",
  builtIn: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const shot = (type: ShotDefinition["type"], prompt = "A {{gender}} model in the {{product}} ({{category}})."): ShotDefinition => ({
  id: type,
  label: type,
  type,
  prompt,
  poseId: null,
  backgroundId: null,
});

// Every input a product can have, deliberately out of order
const ALL_REFS: Reference[] = [
  { role: "accessory", url: "u/acc", label: "Watch" },
  { role: "garment_extra", url: "u/extra" },
  { role: "background", url: "u/bg" },
  { role: "pairing", url: "u/pair", label: "Jeans" },
  { role: "footwear", url: "u/shoes" },
  { role: "garment_detail", url: "u/detail" },
  { role: "garment_back", url: "u/back" },
  { role: "model_face", url: "u/face" },
  { role: "initial_look", url: "u/initial" },
  { role: "previous", url: "u/prev" },
  { role: "garment_front", url: "u/front" },
];

const ctx = (over: Partial<PromptContext> = {}): PromptContext => ({
  shot: shot("initial"),
  isInitial: true,
  product: { name: "Linen Kurta", category: "Ethnic wear", gender: "female", notes: "" },
  styling: "Elegant styling.",
  model: asset("model", "Indian woman, mid-20s."),
  pose: asset("pose", "POSE:\nStand straight.\n\nMOOD:\nCalm.\n\nCAMERA:\nFull body."),
  background: asset("background", "White seamless studio.", { setting: "studio" }),
  accessories: [asset("accessory", "", { name: "Watch" })],
  feedback: "",
  references: ALL_REFS,
  maxRefs: 16,
  ...over,
});

const later = (type: ShotDefinition["type"], over: Partial<PromptContext> = {}) =>
  ctx({ isInitial: false, shot: shot(type), ...over });

// Positions of each heading in the prompt (must be increasing)
function expectInOrder(prompt: string, headings: string[]) {
  const at = headings.map((h) => {
    const i = prompt.indexOf(h);
    expect(i, `missing: ${h}`).toBeGreaterThanOrEqual(0);
    return i;
  });
  expect(at).toEqual([...at].sort((a, b) => a - b));
}

// "- @imgN: <job>" lines of the role map
const roleLines = (prompt: string) => [...prompt.matchAll(/^- @img(\d+): (.*)$/gm)].map((m) => [Number(m[1]), m[2]] as const);

describe("references", () => {
  it("initial look: face, primary garment, then other views, styling, accessories, extras, background", () => {
    const { references } = buildShotRequest(ctx());
    // Initial: front + detail views (+ extras); no back, no initial, no previous
    expect(references).toEqual(["u/face", "u/front", "u/detail", "u/pair", "u/shoes", "u/acc", "u/extra", "u/bg"]);
  });

  it("later shots send no model face and slim garments to the shot's views", () => {
    const front = buildShotRequest(later("front"));
    expect(front.references).not.toContain("u/face");
    expect(front.references).toEqual(["u/front", "u/initial", "u/detail", "u/extra", "u/bg"]);
    // A back shot gets only back views — never the front photo
    const back = buildShotRequest(later("back"));
    expect(back.references).toEqual(["u/back", "u/initial", "u/bg"]);
    expect(back.references).not.toContain("u/front");
  });

  it("regenerate sends the full refs (all of the shot's views, styling, accessories) but still no face", () => {
    const { references } = buildShotRequest(later("front", { regenerate: true }));
    expect(references).toEqual(["u/front", "u/initial", "u/detail", "u/pair", "u/shoes", "u/acc", "u/extra", "u/bg"]);
    expect(references).not.toContain("u/face");
  });

  it("lifestyle shots resend pairing and footwear, not accessories", () => {
    const { references } = buildShotRequest(later("lifestyle"));
    expect(references).toContain("u/pair");
    expect(references).toContain("u/shoes");
    expect(references).not.toContain("u/acc");
  });

  it("sends the face again when a later shot has no initial look image", () => {
    const refs = ALL_REFS.filter((r) => r.role !== "initial_look");
    expect(buildShotRequest(later("front", { references: refs })).references[0]).toBe("u/face");
  });

  it("trims by the original's ranks to the cap, then re-orders for @img tags", () => {
    // Ranks: face 0, front 1, previous 1.5, background 4 (studio front), detail 3,
    // styling 3.5, front_extra 7
    const { references } = buildShotRequest(ctx({ maxRefs: 4, feedback: "fix" }));
    expect(references).toEqual(["u/face", "u/front", "u/detail", "u/prev"]);
    const five = buildShotRequest(ctx({ maxRefs: 5 }));
    expect(five.references).toEqual(["u/face", "u/front", "u/detail", "u/pair", "u/shoes"]);
  });

  it("ranks the background higher on later close-ups", () => {
    const refs: Reference[] = [
      { role: "garment_front", url: "f" },
      { role: "garment_detail", url: "d" },
      { role: "initial_look", url: "il" },
      { role: "background", url: "bg" },
    ];
    expect(buildShotRequest(later("closeup", { references: refs, maxRefs: 3 })).references).toEqual(["f", "il", "bg"]);
    expect(buildShotRequest(later("front", { references: refs, maxRefs: 3 })).references).toEqual(["f", "il", "d"]);
  });

  it("packs styling items into the outfit composite before trimming", () => {
    const { references, sent } = buildShotRequest(
      ctx({ maxRefs: 6, stylingComposites: { outfit: "u/outfit" } }),
    );
    expect(references).toContain("u/outfit");
    expect(references).not.toContain("u/pair");
    const styling = sent.find((r) => r.url === "u/outfit");
    expect(styling?.role).toBe("styling");
    expect(styling?.label).toBe("pairing item: Jeans, footwear, Watch");
    // Under the cap: never merged
    expect(buildShotRequest(ctx({ stylingComposites: { outfit: "u/outfit" } })).references).not.toContain("u/outfit");
  });

  it("uses the pairing+footwear composite when given", () => {
    const { prompt, references } = buildShotRequest(ctx({ stylingComposites: { pairingFootwear: "u/pf" } }));
    expect(references).toContain("u/pf");
    expect(references).not.toContain("u/pair");
    expect(prompt).toMatch(/outfit styling reference only — panels side by side, left to right: pairing item: Jeans, footwear\./);
    expect(prompt).toContain("PAIRING LAYERING");
  });

  it("sends the previous attempt only with feedback, and a user reference ranked 1.5", () => {
    expect(buildShotRequest(ctx()).references).not.toContain("u/prev");
    expect(buildShotRequest(ctx({ feedback: "Longer sleeves" })).references).toContain("u/prev");
    const withRef = buildShotRequest(ctx({ references: [...ALL_REFS, { role: "reference", url: "u/ref" }], maxRefs: 3 }));
    expect(withRef.references).toEqual(["u/face", "u/front", "u/ref"]);
    expect(withRef.prompt).toContain("- @img3: user-supplied regeneration reference — follow its guidance for this retry.");
  });

  it("swaps in the face crop", () => {
    const { references, sent } = buildShotRequest(ctx({ faceCropUrl: "u/crop" }));
    expect(references[0]).toBe("u/crop");
    expect(sent[0]).toMatchObject({ role: "model_face", label: "face_identity_crop" });
  });

  it("sends pattern swatches only for the views the shot uses, first of each view first, max 3", () => {
    const patterns: Reference[] = [
      { role: "pattern", url: "p/f2", slot: "pattern_front_2" },
      { role: "pattern", url: "p/f", slot: "pattern_front" },
      { role: "pattern", url: "p/b", slot: "pattern_back" },
      { role: "pattern", url: "p/d", slot: "pattern_detail" },
      { role: "pattern", url: "p/d2", slot: "pattern_detail_2" },
    ];
    const refs = [...ALL_REFS, ...patterns];
    const initial = pickReferences(ctx({ references: refs })).filter((r) => r.role === "pattern");
    expect(initial.map((r) => r.url)).toEqual(["p/f", "p/d", "p/f2"]);
    const back = pickReferences(later("back", { references: refs })).filter((r) => r.role === "pattern");
    expect(back.map((r) => r.url)).toEqual(["p/b"]);
    expect(buildShotRequest(later("back", { references: refs })).prompt).toContain("PATTERN SWATCH (back print)");
  });

  it("never sends the pose photo unless asked (POSE_AS_IMAGE = false)", () => {
    const refs = [...ALL_REFS, { role: "pose" as const, url: "u/pose" }];
    expect(buildShotRequest(ctx({ references: refs })).references).not.toContain("u/pose");
    const withPose = buildShotRequest(ctx({ references: refs, poseAsImage: true }));
    // face, garment, (initial), pose
    expect(withPose.references.slice(0, 3)).toEqual(["u/face", "u/front", "u/pose"]);
    expect(withPose.prompt).toContain("POSE MATCH (hard constraint");
    expect(withPose.prompt).toContain("POSE STANCE BRIEF (hard constraint — match body from @img3):\nStand straight.");
    expect(withPose.prompt).toContain("FINAL POSE LOCK");
    expect(withPose.prompt).not.toContain("POSE (text):");
  });

  it("drops duplicate URLs", () => {
    const refs: Reference[] = [
      { role: "garment_front", url: "same" },
      { role: "garment_detail", url: "same" },
    ];
    expect(buildShotRequest(ctx({ references: refs })).references).toEqual(["same"]);
  });

  it("falls back to the front photo when the shot's views are missing", () => {
    const refs: Reference[] = [{ role: "garment_front", url: "f" }, { role: "initial_look", url: "il" }];
    expect(buildShotRequest(later("back", { references: refs })).references).toEqual(["f", "il"]);
    expect(missingGarmentRoles(later("back", { references: refs }))).toEqual(["garment_back"]);
    expect(missingGarmentRoles(ctx({ references: refs }))).toEqual([]);
  });
});

describe("prompt blocks", () => {
  it("initial look: blocks in the original order", () => {
    const { prompt } = buildShotRequest(ctx({ product: { name: "Kurta", category: "Ethnic wear", gender: "female", notes: "Soft cotton" } }));
    expectInOrder(prompt, [
      "SKIN DEPTH LOCK",
      "CANONICAL LOOK",
      "ROLE MAP (do not mix jobs):",
      "FACE + SKIN + MAKEUP + HAIR LOCK",
      "BODY PROPORTION LOCK",
      "SHOT:\n",
      "SHOT GUARD",
      "ACCESSORIES (from the accessories reference image ONLY",
      "PAIRING LAYERING",
      "STYLING (secondary",
      "STYLING GUARD",
      "match the pose reference's exact crop/framing.",
      "POSE (text):\nPOSE:\nStand straight.",
      "STUDIO INTEGRATION",
      "NATURAL STUDIO (hard constraint): Person photographed IN @img8",
      "BACKGROUND NOTES (apply to this shot):\nWhite seamless studio.",
      "Product notes: Soft cotton",
      // "Ethnic wear" isn't saree/salwar/coord/kurta/lehenga: the generic fit block
      "GARMENT FIT (hard constraint):",
      "Finish: pressed fabric",
      "Rendering: clean catalog look",
      "REFERENCE OUTPUT QUALITY",
      "LOOK SHOT BENCHMARK",
      "GARMENT COLOR — DO NOT CHANGE (hard constraint): the garment's own color never changes from @img2.",
      OUTPUT_SHARPNESS,
    ]);
    expect(prompt).not.toContain("SESSION CONTINUITY");
    expect(prompt.endsWith(OUTPUT_SHARPNESS)).toBe(true);
  });

  it("later shot: session continuity with the side override, then the role map", () => {
    const { prompt } = buildShotRequest(later("side"));
    expectInOrder(prompt, [
      "SKIN DEPTH LOCK (hard constraint — failure if violated): Match @img2 melanin depth",
      "SESSION CONTINUITY",
      "SIDE OVERRIDE",
      "STUDIO SET + COLOR LOCK",
      "ROLE MAP",
      "FACE + MAKEUP CONTINUITY: same person/skin/makeup as Initial Look at side/profile angle",
      "HEIGHT GROUND TRUTH: match @img2's",
      "SHOT:",
      "ACCESSORIES (same as Initial Look)",
      "PAIRING (same as Initial Look)",
      "FOOTWEAR (same as Initial Look)",
      "SHOT PURPOSE: silhouette check",
      "FULL LENGTH SIDE (hard constraint)",
      "POSE (text):",
      "STUDIO INTEGRATION",
      "Subject must match the Initial Look's studio lighting",
      "Finish: pressed fabric, exact product color — same neutral white balance",
      "Rendering: match Initial Look catalog grade exactly",
      "SIDE SHOT BENCHMARK",
    ]);
    expect(prompt).not.toContain("CANONICAL LOOK");
    expect(prompt).not.toContain("STYLING (secondary");
    expect(prompt).not.toContain("PRIMARY FACE IDENTITY");
  });

  it("back shot: back override, rear face continuity, back framing", () => {
    const { prompt } = buildShotRequest(later("back"));
    expect(prompt).toContain("BACK OVERRIDE");
    expect(prompt).toContain("FACE CONTINUITY (rear)");
    expect(prompt).toContain("SHOT PURPOSE: shoppers check this to confirm back construction");
    expect(prompt).toContain("BACK: full-length rear view");
    expect(prompt).toContain("BACK SHOT BENCHMARK");
  });

  it("lifestyle: exception, lifestyle lighting, scene recreation and 6-line scene brief", () => {
    const { prompt } = buildShotRequest(
      later("lifestyle", { background: asset("background", "Old courtyard.", { setting: "lifestyle" }) }),
    );
    expect(prompt).toContain("LIFESTYLE EXCEPTION");
    expect(prompt).toContain("LIFESTYLE INTEGRATION (hard constraint");
    expect(prompt).toContain("SCENE RECREATION (hard constraint — @img");
    expect(prompt).toMatch(/- @img\d+: LOCATION \/ MOOD \/ LIGHT REFERENCE ONLY/);
    expect(prompt).toContain("BACKGROUND (recreated scene — hard constraint; any plate/brief is REFERENCE ONLY):\nOld courtyard.");
    expect(prompt).toContain("Cast realistic soft contact shadows");
    expect(prompt).toContain("LIFESTYLE COLOR FIDELITY: exact @img1 / Initial Look");
    expect(prompt).not.toContain("REFERENCE OUTPUT QUALITY");
    expect(prompt).not.toContain("{{");
  });

  it("close-up with a lifestyle plate gets the bokeh line", () => {
    const { prompt } = buildShotRequest(
      later("closeup", { background: asset("background", "Garden.", { setting: "lifestyle" }) }),
    );
    expect(prompt).toContain("Close-up: show only heavily defocused bokeh of this environment behind the garment.");
    expect(prompt).toContain("CLOSE-UP BENCHMARK");
  });

  it("binds @imgN to the order sent", () => {
    const { prompt, sent } = buildShotRequest(ctx());
    const jobs: Partial<Record<Reference["role"], RegExp>> = {
      model_face: /PRIMARY FACE IDENTITY/,
      garment_front: /CLOTHING ONLY/,
      garment_detail: /SAME product, detail \/ close-up view/,
      garment_extra: /SAME product, extra front view/,
      pairing: /pairing item worn with the product \(pairing item: Jeans\)/,
      footwear: /footwear reference only/,
      accessory: /accessories reference only \(Watch\)/,
      background: /background plate only\./,
    };
    const lines = new Map(roleLines(prompt));
    sent.forEach((ref, i) => expect(lines.get(i + 1)).toMatch(jobs[ref.role]!));
    expect(prompt).toContain("Dress @img1 in @img2. FACE TRANSFER");
  });

  it("later shots name the initial look as @img2 and the garment as ground truth", () => {
    const { prompt } = buildShotRequest(later("front"));
    expect(prompt).toContain("- @img1: GARMENT GROUND TRUTH");
    expect(prompt).toContain("- @img2: FACE + MAKEUP + HAIR + OUTFIT ground truth");
    expect(prompt).toContain("Copy person, clothes, hair, makeup, skin tone, height/proportions, color look, and mood/expression from @img2.");
    expect(prompt).toMatch(/- @img\d+: SAME studio environment as Initial Look/);
    const fresh = buildShotRequest(later("front", { inheritBackground: false })).prompt;
    expect(fresh).toMatch(/- @img\d+: NEW environment — place the person in this exact location/);
  });

  it("template variables: image tags, our text vars, and line dropping", () => {
    const prompt = buildShotRequest(
      ctx({
        shot: shot(
          "initial",
          "Hero of {{product}} ({{category}}, {{gender}}) from {{front_image}}\nBack per {{back_image}}\nModel {{model_image}}\nUnknown {{nope}}\nPlain line",
        ),
      }),
    ).prompt;
    expect(prompt).toContain("SHOT:\nHero of Linen Kurta (Ethnic wear, female) from @img2\nModel @img1\nPlain line\n\nSHOT GUARD");
    expect(prompt).not.toContain("Back per");
    expect(prompt).not.toContain("Unknown");
    // A shot whose every line drops has no SHOT block (and no guard)
    const empty = buildShotRequest(ctx({ shot: shot("initial", "{{pose_image}}") })).prompt;
    expect(empty).not.toContain("SHOT:");
    expect(empty).not.toContain("SHOT GUARD");
  });

  it("supports all 11 original variables", () => {
    const vars = "garment_image front_image back_image detail_image model_image initial_look pose_image background pairing_image footwear_image accessories_image";
    const text = vars.split(" ").map((v) => `${v}={{${v}}}`).join("\n");
    const refs = [...ALL_REFS, { role: "pose" as const, url: "u/pose" }];
    const { prompt, references } = buildShotRequest(
      later("front", { shot: shot("front", text), references: refs, regenerate: true, poseAsImage: true }),
    );
    const tag = (url: string) => `@img${references.indexOf(url) + 1}`;
    for (const [name, url] of [
      ["garment_image", "u/front"],
      ["front_image", "u/front"],
      ["initial_look", "u/initial"],
      ["pose_image", "u/pose"],
      ["background", "u/bg"],
      ["pairing_image", "u/pair"],
      ["footwear_image", "u/shoes"],
      ["accessories_image", "u/acc"],
    ]) {
      expect(prompt).toContain(`${name}=${tag(url)}`);
    }
    // Not sent on this shot → dropped: back (front shot), model face (later shot).
    // detail_image narrows the garments: only front + detail are sent here.
    expect(prompt).toContain(`detail_image=${tag("u/detail")}`);
    expect(prompt).not.toContain("back_image=");
    expect(prompt).not.toContain("model_image=");
  });

  it("narrows garment views from {{back_image}} in the shot prompt", () => {
    const { references } = buildShotRequest(later("front", { shot: shot("front", "Back detail {{back_image}}") }));
    expect(references).toEqual(["u/back", "u/initial", "u/bg"]);
  });

  it("dark-skin variants only with a dark measurement", () => {
    const plain = buildShotRequest(ctx()).prompt;
    expect(plain).not.toContain("Measured from the model face photo");
    expect(plain).toContain("SKIN FINISH: natural dry-to-satin catalog skin");
    const dark = buildShotRequest(ctx({ skinDepth: { label: "deep brown", fitzpatrick: "V", isDark: true } })).prompt;
    // The original's join leaves a double space after the measured line
    expect(dark).toContain("Measured from the model face photo: deep brown (Fitzpatrick V).  Match @img1 melanin depth");
    expect(dark).toContain("If unsure between two shades, pick the DARKER one");
    expect(dark).toContain("SKIN FINISH (dark skin)");
    expect(dark).toContain("LIGHTING HIGHLIGHTS (dark skin): soft chin/nose shadow for depth");
    expect(dark).toContain("LIGHTING HIGHLIGHTS (dark skin): keep soft chin/nose shadow for depth");
    expect(dark).toContain("Finish: pressed fabric, exact product color, neutral catalog daylight white balance on backdrop and garment. SKIN:");
    expect(dark).toContain("Exact face + skin from model face: deep brown.");
    const light = buildShotRequest(ctx({ skinDepth: { label: "light", fitzpatrick: "II", isDark: false } })).prompt;
    expect(light).toContain("Measured from the model face photo: light (Fitzpatrick II).");
    expect(light).not.toContain("(dark skin)");
  });

  it("no identity lock without a face or initial look", () => {
    const refs = ALL_REFS.filter((r) => r.role !== "model_face" && r.role !== "initial_look");
    const { prompt } = buildShotRequest(ctx({ references: refs }));
    expect(prompt).not.toContain("SKIN DEPTH LOCK (hard constraint");
    expect(prompt).not.toContain("FACE + SKIN + MAKEUP + HAIR LOCK");
    expect(prompt).toContain("Dress the model in @img1.");
  });

  it("wear style lock: initial look, ethnic categories only; pose notes win", () => {
    const model = asset("model", "", { notes: "Pleats tucked left." });
    const ethnic = buildShotRequest(ctx({ model })).prompt;
    expect(ethnic).toContain("WEAR STYLE LOCK (draping technique only — from a different reference photo):\nPleats tucked left.\nApply only this draping/arrangement technique to @img2");
    const pose = buildShotRequest(ctx({ model, poseWearStyleNotes: "Pallu over left shoulder." })).prompt;
    expect(pose).toContain("WEAR STYLE LOCK (draping technique only — from a different reference photo):\nPallu over left shoulder.");
    const western = buildShotRequest(ctx({ model, product: { name: "Tee", category: "T-shirts", gender: "male", notes: "" } })).prompt;
    expect(western).not.toContain("WEAR STYLE LOCK");
    expect(buildShotRequest(later("front", { model })).prompt).not.toContain("WEAR STYLE LOCK");
  });

  it("garment fit by category, saree blouse restyle from STYLING", () => {
    const saree = (styling: string) =>
      buildShotRequest(ctx({ styling, model: null, product: { name: "S", category: "Sarees", gender: "female", notes: "" } })).prompt;
    expect(saree("Elegant.")).toContain("SAME BLOUSE: keep the blouse from @img2");
    expect(saree("Red choli with puff sleeves.")).toContain("BLOUSE (from STYLING only — not from product refs)");
    expect(buildShotRequest(ctx({ product: { name: "K", category: "Kurta sets", gender: "female", notes: "" } })).prompt).toContain(
      "GARMENT FIT (ethnic set — hard constraint):",
    );
    expect(buildShotRequest(ctx({ product: { name: "S", category: "Salwar suits", gender: "female", notes: "" } })).prompt).toContain(
      "GARMENT FIT (salwar kameez — hard constraint):",
    );
    expect(buildShotRequest(ctx({ product: { name: "T", category: "T-shirts", gender: "male", notes: "" } })).prompt).toContain(
      "GARMENT FIT (hard constraint):\nCopy the exact fit and silhouette from @img2",
    );
  });

  it("STYLING text: model description when given, else the model prompt + template styling", () => {
    const fallback = buildShotRequest(ctx()).prompt;
    expect(fallback).toContain("STYLING (secondary — body proportions / garment vibe only — NEVER override face, skin depth, or makeup from the model face photo):\nIndian woman, mid-20s.\nElegant styling.\nSTYLING GUARD");
    const picked = buildShotRequest(ctx({ modelDescription: "Tall {{gender}} model." })).prompt;
    expect(picked).toContain("from the model face photo):\nTall female model.\nSTYLING GUARD");
    expect(buildShotRequest(ctx({ modelDescription: null })).prompt).not.toContain("STYLING (secondary");
  });

  it("uploaded accessories are listed", () => {
    const refs = [...ALL_REFS, { role: "accessory" as const, url: "u/up", label: "Silver chain", uploaded: true }];
    const { prompt } = buildShotRequest(ctx({ references: refs }));
    expect(prompt).toContain("- Watch\n- uploaded accessory: Silver chain");
  });

  it("dynamic shot keys (phase C)", () => {
    const { prompt } = buildShotRequest(later("lifestyle", { shotType: "dynamic_lifestyle" }));
    expect(prompt).toContain("DYNAMIC: invent a fresh pose/camera for this shot.");
    expect(prompt).toContain("Recreate a fresh nearby scene inspired by the specified background's mood");
    expect(prompt).not.toContain("POSE (text):");
    expect(prompt).not.toContain("BACKGROUND NOTES");
    const close = buildShotRequest(later("closeup", { shotType: "closeup_dynamic_back" })).prompt;
    expect(close).toContain("DYNAMIC: invent a bold, editorial close-up");
    expect(close).toContain("DYNAMIC SHOT BENCHMARK");
    expect(close).toContain("FACE CONTINUITY (rear)");
  });

  it("feedback: correction block before sharpness", () => {
    expect(buildShotRequest(ctx()).prompt).not.toContain(CORRECTION_HEADING);
    const { prompt } = buildShotRequest(ctx({ feedback: "Make the sleeves longer" }));
    expectInOrder(prompt, ["GARMENT COLOR — DO NOT CHANGE", CORRECTION_HEADING, "Make the sleeves longer", OUTPUT_SHARPNESS]);
    expect(prompt).toMatch(/- @img\d+: PREVIOUS ATTEMPT of this shot/);
  });

  it("has no length budget, only the 32000-character safety cap", () => {
    const long = "word ".repeat(1500);
    const big = buildShotRequest(ctx({ product: { name: "K", category: "Sarees", gender: "female", notes: long } })).prompt;
    expect(big.length).toBeGreaterThan(15000);
    expect(big).toContain(long.trim());
    const huge = "word ".repeat(9000);
    const capped = buildShotRequest(
      ctx({ product: { name: "K", category: "Sarees", gender: "female", notes: huge }, feedback: "Fix the collar." }),
    ).prompt;
    expect(capped.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
    expect(capped).toContain(`${CORRECTION_HEADING}\nFix the collar.`);
    expect(capped.endsWith(OUTPUT_SHARPNESS)).toBe(true);
  });

  it("every shot type builds a bound prompt", () => {
    for (const s of SHOT_TYPES) {
      const { prompt } = buildShotRequest(ctx({ isInitial: s === "initial", shot: shot(s) }));
      expect(prompt).not.toMatch(/\{\{/);
      expect(prompt.endsWith(OUTPUT_SHARPNESS)).toBe(true);
    }
    for (const key of ORIGINAL_SHOT_TYPES) {
      const { prompt } = buildShotRequest(later("front", { shotType: key }));
      expect(prompt).not.toMatch(/\{\{/);
    }
  });

  it("maps our shot types onto the original keys", () => {
    expect(SHOT_TYPES.map((type) => originalShotType({ shot: shot(type) }))).toEqual([
      "initial",
      "front",
      "back",
      "side",
      "closeup",
      "closeup",
      "lifestyle",
      "front",
    ]);
    expect(originalShotType({ shot: shot("front"), shotType: "front_full_sleeve" })).toBe("front_full_sleeve");
  });
});

describe("presets", () => {
  it("has unique asset keys and valid kinds", () => {
    const keys = PRESET_ASSETS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of PRESET_ASSETS) expect(ASSET_KINDS).toContain(a.kind);
  });

  it("templates reference existing assets of the right kind", () => {
    const byKey = new Map(PRESET_ASSETS.map((a) => [a.key, a]));
    const templateKeys = PRESET_TEMPLATES.map((t) => t.key);
    expect(new Set(templateKeys).size).toBe(templateKeys.length);
    for (const t of PRESET_TEMPLATES) {
      for (const s of t.shots) {
        if (s.poseKey) expect(byKey.get(s.poseKey)?.kind).toBe("pose");
        if (s.backgroundKey) expect(byKey.get(s.backgroundKey)?.kind).toBe("background");
      }
    }
  });

  it("templates start with the initial look, have unique shot ids and ≤ MAX_SHOTS", () => {
    for (const t of PRESET_TEMPLATES) {
      expect(t.shots[0].type).toBe("initial");
      expect(t.shots.length).toBeLessThanOrEqual(MAX_SHOTS);
      const ids = t.shots.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of t.shots) expect(SHOT_TYPES).toContain(s.type);
    }
  });
});

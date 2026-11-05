import { describe, expect, it } from "vitest";
import { PRESET_ASSETS, PRESET_TEMPLATES } from "@/lib/catalogue/presets";
import {
  CORRECTION_HEADING,
  OUTPUT_SHARPNESS,
  PROMPT_TARGET,
  buildShotRequest,
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
  accessories: [],
  feedback: "",
  references: ALL_REFS,
  maxRefs: 14,
  ...over,
});

// "- Image N: <job>" lines → the job text per number
const imageLines = (prompt: string) => [...prompt.matchAll(/^- Image (\d+): (.*)$/gm)].map((m) => [Number(m[1]), m[2]] as const);

describe("buildShotRequest references", () => {
  it("caps to maxRefs and keeps garment front first", () => {
    const { references } = buildShotRequest(ctx({ maxRefs: 3 }));
    expect(references).toHaveLength(3);
    expect(references[0]).toBe("u/front");
    expect(references).toEqual(["u/front", "u/face", "u/back"]);
  });

  it("keeps garment front first even when it's last in the input", () => {
    for (const isInitial of [true, false]) {
      const { references } = buildShotRequest(ctx({ isInitial, shot: shot(isInitial ? "initial" : "back") }));
      expect(references[0]).toBe("u/front");
    }
  });

  it("sends the initial look (high) for later shots, never for the initial one", () => {
    const later = buildShotRequest(ctx({ isInitial: false, shot: shot("front"), maxRefs: 3 }));
    expect(later.references).toEqual(["u/front", "u/initial", "u/face"]);
    const first = buildShotRequest(ctx());
    expect(first.references).not.toContain("u/initial");
  });

  it("puts the back view up front for a back shot", () => {
    const { references } = buildShotRequest(ctx({ isInitial: false, shot: shot("back"), maxRefs: 4 }));
    expect(references).toEqual(["u/front", "u/initial", "u/back", "u/face"]);
  });

  it("sends the previous attempt only with feedback", () => {
    expect(buildShotRequest(ctx()).references).not.toContain("u/prev");
    expect(buildShotRequest(ctx({ feedback: "Make the sleeves longer" })).references).toContain("u/prev");
  });

  it("drops duplicate URLs", () => {
    const refs: Reference[] = [
      { role: "garment_front", url: "same" },
      { role: "garment_back", url: "same" },
    ];
    expect(buildShotRequest(ctx({ references: refs })).references).toEqual(["same"]);
  });
});

describe("buildShotRequest prompt", () => {
  it("numbers the images in the order they're sent", () => {
    const { prompt, references } = buildShotRequest(ctx({ isInitial: false, shot: shot("back"), maxRefs: 6 }));
    const lines = imageLines(prompt);
    expect(lines.map(([n]) => n)).toEqual(references.map((_, i) => i + 1));
    const jobFor: Record<string, RegExp> = {
      "u/front": /GARMENT GROUND TRUTH/,
      "u/initial": /INITIAL LOOK/,
      "u/back": /back view/,
      "u/face": /PRIMARY FACE IDENTITY/,
      "u/detail": /detail/,
      "u/bg": /studio background/,
    };
    references.forEach((url, i) => expect(lines[i][1]).toMatch(jobFor[url]));
  });

  it("adds the correction block only with feedback", () => {
    expect(buildShotRequest(ctx()).prompt).not.toContain(CORRECTION_HEADING);
    const { prompt } = buildShotRequest(ctx({ feedback: "Make the sleeves longer" }));
    expect(prompt).toContain(CORRECTION_HEADING);
    expect(prompt).toContain("Make the sleeves longer");
  });

  it("fills {{vars}} in the shot prompt", () => {
    const { prompt } = buildShotRequest(ctx({ shot: shot("initial", "A {{gender}} model in {{product}} ({{category}}) {{front_image}} {{nope}}.") }));
    expect(prompt).toContain("A female model in Linen Kurta (Ethnic wear) image 1 .");
    expect(prompt).not.toMatch(/\{\{/);
  });

  it("has no image identity lock without a model face", () => {
    const refs = ALL_REFS.filter((r) => r.role !== "model_face");
    for (const isInitial of [true, false]) {
      const { prompt } = buildShotRequest(ctx({ references: refs, isInitial, shot: shot(isInitial ? "initial" : "front") }));
      expect(prompt).not.toContain("SKIN DEPTH LOCK");
      expect(prompt).not.toContain("FACE + HAIR LOCK");
      expect(prompt).not.toContain("PRIMARY FACE IDENTITY");
    }
    const { prompt } = buildShotRequest(ctx());
    expect(prompt).toContain("SKIN DEPTH LOCK");
    expect(prompt).toContain("FACE + HAIR LOCK");
  });

  it("has session continuity only for later shots, canonical look for the first", () => {
    const first = buildShotRequest(ctx()).prompt;
    expect(first).toContain("CANONICAL LOOK");
    expect(first).not.toContain("SESSION CONTINUITY");
    const later = buildShotRequest(ctx({ isInitial: false, shot: shot("back") })).prompt;
    expect(later).toContain("SESSION CONTINUITY");
    expect(later).toContain("BACK OVERRIDE");
  });

  it("always ends with color lock and sharpness", () => {
    const { prompt } = buildShotRequest(ctx());
    expect(prompt).toContain("GARMENT COLOR — DO NOT CHANGE");
    expect(prompt.trimEnd().endsWith(OUTPUT_SHARPNESS)).toBe(true);
  });

  it("describes a model when there's no persona", () => {
    const { prompt } = buildShotRequest(ctx({ model: null, product: { name: "Tee", category: "T-shirts", gender: "male", notes: "" } }));
    expect(prompt).toMatch(/MODEL: a tall adult man fashion model who fits T-shirts/);
  });

  it("stays near the size target with long inputs", () => {
    const long = "word ".repeat(900);
    const { prompt } = buildShotRequest(
      ctx({
        isInitial: false,
        shot: shot("lifestyle", long),
        pose: asset("pose", long),
        model: asset("model", long, { notes: long }),
        background: asset("background", long, { setting: "lifestyle" }),
        product: { name: "Kurta", category: "Sarees", gender: "female", notes: long },
        styling: long,
        feedback: long,
      }),
    );
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_TARGET);
    expect(prompt).toContain(CORRECTION_HEADING);
    expect(prompt).toContain("GARMENT COLOR — DO NOT CHANGE");
  });

  it("keeps a typical prompt under the target", () => {
    for (const s of SHOT_TYPES) {
      const { prompt } = buildShotRequest(ctx({ isInitial: s === "initial", shot: shot(s), feedback: "Fix the collar." }));
      expect(prompt.length).toBeLessThanOrEqual(PROMPT_TARGET);
    }
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

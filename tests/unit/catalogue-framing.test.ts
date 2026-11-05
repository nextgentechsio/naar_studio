import { describe, expect, it } from "vitest";
import { PRESET_ASSETS, PRESET_TEMPLATES } from "@/lib/catalogue/presets";
import { buildShotRequest, type PromptContext, type Reference } from "@/lib/catalogue/prompt";
import { categoryFraming, framingOf, type PublicAsset, type ShotDefinition } from "@/lib/catalogue/shared";

// Framing by category: Top wear shows head to mid-thigh,
// Bottoms chest to feet, the rest stays full length

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

const template = PRESET_TEMPLATES.find((t) => t.key === "tpl-ecommerce-standard")!;
const shotOf = (type: ShotDefinition["type"]): ShotDefinition => {
  const preset = template.shots.find((s) => s.type === type)!;
  return { id: preset.id, label: preset.label, type, prompt: preset.prompt, poseId: null, backgroundId: null };
};
const posePrompt = PRESET_ASSETS.find((a) => a.key === "pose-front-standing")!.prompt;

const REFS: Reference[] = [
  { role: "garment_front", url: "u/front" },
  { role: "garment_back", url: "u/back" },
  { role: "model_face", url: "u/face" },
  { role: "initial_look", url: "u/initial" },
];

const ctx = (type: ShotDefinition["type"], over: Partial<PromptContext> = {}): PromptContext => ({
  shot: shotOf(type),
  isInitial: type === "initial",
  product: { name: "Black hoodie", category: "Top wear", gender: "male", notes: "" },
  styling: "Clean styling.",
  model: asset("model", "Man, mid-20s."),
  pose: asset("pose", posePrompt),
  background: null,
  accessories: [],
  feedback: "",
  references: type === "initial" ? REFS.filter((r) => r.role !== "initial_look") : REFS,
  maxRefs: 8,
  ...over,
});

const WHOLE_BODY = /head[- ]to[- ](?:toe|feet)|full[- ]length|full[- ]body|do not crop hem or shoes|shoes in frame/i;

describe("catalogue framing by category", () => {
  it("maps categories (old names too), with the product's own choice first", () => {
    expect(categoryFraming("Top wear")).toBe("upper");
    expect(categoryFraming("Tops")).toBe("upper");
    expect(categoryFraming("T-shirts")).toBe("upper");
    expect(categoryFraming("Bottoms")).toBe("lower");
    expect(categoryFraming("Dresses")).toBe("full");
    expect(categoryFraming("Something custom")).toBe("full");
    expect(framingOf({ category: "Top wear", framing: null })).toBe("upper");
    expect(framingOf({ category: "Top wear", framing: "full" })).toBe("full");
  });

  for (const type of ["initial", "front", "back", "side"] as const) {
    for (const withPose of [false, true]) {
      it(`frames the ${type} shot upper body${withPose ? " (pose photo sent)" : ""}`, () => {
        const pose = withPose ? asset("pose", posePrompt, { imageUrl: "u/pose" }) : asset("pose", posePrompt);
        const { prompt } = buildShotRequest(ctx(type, { framing: "upper", pose, poseAsImage: withPose }));
        expect(prompt).not.toMatch(WHOLE_BODY);
        expect(prompt).toContain("head to mid-thigh");
        expect(prompt).toContain("FRAMING (hard constraint");
        expect(prompt).toContain("Knees, lower legs and shoes stay OUT of frame");
        // The final rule comes after everything it overrides
        expect(prompt.indexOf("FRAMING (hard constraint")).toBeGreaterThan(prompt.lastIndexOf("head to mid-thigh") - 400);
      });
    }
  }

  it("frames bottoms from the chest down, face out of frame", () => {
    const { prompt } = buildShotRequest(
      ctx("initial", { framing: "lower", product: { name: "Denim shorts", category: "Bottoms", gender: "male", notes: "" } }),
    );
    expect(prompt).not.toMatch(WHOLE_BODY);
    expect(prompt).toContain("LOWER-BODY FRAMING");
    expect(prompt).toContain("The face stays OUT of frame");
  });

  it("prints a sample", () => {
    if (process.env.SHOW_PROMPT) console.log(buildShotRequest(ctx("initial", { framing: "upper" })).prompt);
  });

  it("leaves full length, close-ups and lifestyle exactly as ported", () => {
    for (const type of ["initial", "front", "back", "side"] as const) {
      expect(buildShotRequest(ctx(type, { framing: "full" })).prompt).toBe(buildShotRequest(ctx(type)).prompt);
    }
    for (const type of ["detail", "lifestyle"] as const) {
      expect(buildShotRequest(ctx(type, { framing: "upper" })).prompt).toBe(buildShotRequest(ctx(type)).prompt);
    }
    expect(buildShotRequest(ctx("initial", { framing: "full" })).prompt).toMatch(/head-to-toe/);
  });
});

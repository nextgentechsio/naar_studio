import type { Color, ColorLook } from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: COLOR
//
// A clip's grade as the numbers the shader uses
// (lib/cuts/compositor.ts), so preview and export look
// the same. Looks are a colour matrix plus an offset,
// mixed in by `lookAmount`.
// --------------------------------------------------

// Row-major 3×3 colour matrix and an RGB offset
export type LookMatrix = { matrix: number[]; offset: [number, number, number] };

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LUMA = [0.2126, 0.7152, 0.0722];

const LOOKS: Record<ColorLook, LookMatrix> = {
  none: { matrix: IDENTITY, offset: [0, 0, 0] },
  // Shadows to teal, skin to orange
  "teal-orange": { matrix: [1.12, -0.06, -0.06, -0.04, 1.04, 0.0, -0.1, 0.02, 1.08], offset: [0.0, 0.01, 0.03] },
  "warm-film": { matrix: [1.08, 0.04, -0.02, 0.02, 1.0, 0.0, -0.04, 0.02, 0.9], offset: [0.03, 0.015, 0.0] },
  "cool-night": { matrix: [0.86, 0.04, 0.06, 0.0, 0.96, 0.06, 0.02, 0.06, 1.12], offset: [0.0, 0.01, 0.04] },
  mono: {
    matrix: [LUMA[0], LUMA[1], LUMA[2], LUMA[0], LUMA[1], LUMA[2], LUMA[0], LUMA[1], LUMA[2]],
    offset: [0, 0, 0],
  },
  // Lifted blacks, softer colour
  faded: { matrix: [0.86, 0.08, 0.06, 0.06, 0.86, 0.08, 0.06, 0.08, 0.84], offset: [0.06, 0.06, 0.07] },
  vivid: { matrix: [1.22, -0.12, -0.1, -0.08, 1.2, -0.12, -0.08, -0.12, 1.2], offset: [0, 0, 0] },
};

export const LOOK_NAMES: Record<ColorLook, string> = {
  none: "None",
  "teal-orange": "Teal & orange",
  "warm-film": "Warm film",
  "cool-night": "Cool night",
  mono: "Mono",
  faded: "Faded",
  vivid: "Vivid",
};

// The look at `amount` (0 = no change)
export function lookMatrix(look: ColorLook, amount: number): LookMatrix {
  const target = LOOKS[look] ?? LOOKS.none;
  const t = Math.min(1, Math.max(0, amount));
  return {
    matrix: target.matrix.map((value, index) => IDENTITY[index] + (value - IDENTITY[index]) * t),
    offset: target.offset.map((value) => value * t) as [number, number, number],
  };
}

// White balance as RGB multipliers: warm adds red and
// takes blue; tint trades green for magenta
export function balanceGains(temperature: number, tint: number): [number, number, number] {
  const warm = Math.min(1, Math.max(-1, temperature)) * 0.18;
  const magenta = Math.min(1, Math.max(-1, tint)) * 0.12;
  return [1 + warm + magenta * 0.5, 1 - magenta, 1 - warm + magenta * 0.5];
}

export const isNeutral = (color: Color) =>
  color.exposure === 0 &&
  color.contrast === 0 &&
  color.saturation === 1 &&
  color.temperature === 0 &&
  color.tint === 0 &&
  color.highlights === 0 &&
  color.shadows === 0 &&
  color.vignette === 0 &&
  (color.look === "none" || color.lookAmount === 0);

// The same grade on one RGB value (0–1), as the shader
// does it: for tests and for colour previews
export function gradePixel(rgb: [number, number, number], color: Color): [number, number, number] {
  const gain = Math.pow(2, color.exposure);
  const balance = balanceGains(color.temperature, color.tint);
  let [r, g, b] = rgb.map((value, index) => value * gain * balance[index]);

  // Shadows and highlights: lift the darks, pull the brights
  const luma = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  const shadowWeight = Math.max(0, 1 - luma * 2);
  const highlightWeight = Math.max(0, luma * 2 - 1);
  const tone = color.shadows * 0.25 * shadowWeight + color.highlights * 0.25 * highlightWeight;
  [r, g, b] = [r + tone, g + tone, b + tone];

  // Contrast around mid grey
  const contrast = 1 + color.contrast;
  [r, g, b] = [r, g, b].map((value) => (value - 0.5) * contrast + 0.5);

  // Saturation around the pixel's own grey
  const grey = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  [r, g, b] = [r, g, b].map((value) => grey + (value - grey) * color.saturation);

  const { matrix, offset } = lookMatrix(color.look, color.lookAmount);
  const looked: [number, number, number] = [
    matrix[0] * r + matrix[1] * g + matrix[2] * b + offset[0],
    matrix[3] * r + matrix[4] * g + matrix[5] * b + offset[1],
    matrix[6] * r + matrix[7] * g + matrix[8] * b + offset[2],
  ];

  return looked.map((value) => Math.min(1, Math.max(0, value))) as [number, number, number];
}

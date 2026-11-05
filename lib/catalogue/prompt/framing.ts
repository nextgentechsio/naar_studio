import type { Framing, ShotType } from "../shared";

// --------------------------------------------------
// FRAMING BY CATEGORY (ours; the original always shoots
// the main views full length)
//
// For an upper- or lower-body framing, the ported prompt
// is built word for word as usual, then its full-length
// lines are rewritten to the framing here and a final hard
// rule is added. Only the main views change (initial look,
// front, back, side); close-ups and lifestyle keep theirs.
// --------------------------------------------------

const FRAMED_SHOTS: ReadonlySet<ShotType> = new Set(["initial", "front", "back", "side"]);

export function framingApplies(framing: Framing | undefined, shotType: ShotType): framing is "upper" | "lower" {
  return (framing === "upper" || framing === "lower") && FRAMED_SHOTS.has(shotType);
}

// The span in a few words, and the full instruction
function words(framing: "upper" | "lower", product: string) {
  return framing === "upper"
    ? {
        span: "head to mid-thigh",
        label: "UPPER-BODY FRAMING",
        line:
          `UPPER-BODY FRAMING: frame from just above the head down to mid-thigh — the ${product} fills the frame ` +
          `with its whole length, hem, cuffs and sleeves visible and a small margin below the hem. Knees, lower legs ` +
          `and shoes stay OUT of frame. Do not pull back to show the whole body, and do not crop tighter than mid-thigh.`,
      }
    : {
        span: "lower chest down to the feet",
        label: "LOWER-BODY FRAMING",
        line:
          `LOWER-BODY FRAMING: frame from the lower chest down to the feet — the ${product} fills the frame with its ` +
          `waistband, fit, length and hem fully visible, shoes and a small floor margin in frame. The face stays OUT ` +
          `of frame. Do not pull back to show the whole body.`,
      };
}

// The shot's own prompt (ours, from the template)
export function frameShotText(text: string, framing: "upper" | "lower"): string {
  const { span } = words(framing, "garment");
  return text
    .replace(/complete outfit uncropped/gi, "garment fully in frame")
    .replace(/(?:complete outfit )?head-to-toe(?: with margin)?/gi, span)
    .replace(/\bfull[- ]length\s+/gi, "");
}

// The built prompt: full-length lines → the framing, plus
// a last hard rule that wins over anything left
export function applyFraming(body: string, framing: "upper" | "lower", product: string): string {
  const { span, label, line } = words(framing, product);
  const swaps: [RegExp, string][] = [
    // shotFramingLine
    [/FULL LENGTH SIDE \(hard constraint\): (true side \/ profile camera[^\n]*?)Head-to-toe with margin — do not crop hem or shoes\./g, `SIDE (hard constraint): $1${line}`],
    [/FULL LENGTH: head-to-toe with margin — do not crop hem or shoes\./g, line],
    [/BACK: full-length rear view, head-to-toe with margin —/g, `BACK: rear view, ${span} —`],
    [/match the pose reference's exact crop\/framing\./g, line],
    // Pose match: the pose sets the stance, not the crop
    [/^- If (\S+) is full-length \/ head-to-toe, keep full-length[^\n]*\n?/gm, ""],
    [/^- If (\S+) is tighter \(waist-up, hip, etc\.\), stay that tight[^\n]*\n?/gm, ""],
    [/^- Do not zoom in tighter or out wider than (\S+)\.\n?/gm, ""],
    [/^FRAME from (\S+): same camera angle, distance, and crop edges — same body coverage and subject-vs-background fill\./gm, `FRAME from $1: same camera angle only — the crop is the ${label} below, not $1's body coverage.`],
    [/2\) FRAME: match (\S+)'s exact body coverage and subject\/background ratio\.[^\n]*/g, `2) FRAME: ${line}`],
    [/cropping a full-height pose shorter; /g, ""],
    // Quality benchmarks
    [/Full-length studio portrait head-to-toe/g, `Studio portrait, ${span}`],
    [/Full-length side-profile studio portrait/g, `Side-profile studio portrait, ${span}`],
    [/Full-length true rear view/g, `True rear view, ${span}`],
    [/complete outfit head-to-toe with margin/g, span],
    [/complete outfit uncropped/g, "garment fully in frame"],
    [/on every full-length shot/g, "on every shot"],
    // Body proportion lock
    [/Full-length head-to-toe with generous leg length visible — hem and shoes in frame\./g, `Framed ${span} — natural adult proportions within that crop.`],
    [/ — if that pose reads tall\/full-length, output must look equally tall\./g, "."],
    [/, or a crop that makes the model look shorter than Initial Look \/ pose\./g, "."],
    // Pose text camera notes (library poses)
    [/Full (?:seated )?body head to (?:toe|feet)(?: with (?:headroom and floor )?margin)?/gi, `Framed ${span}`],
  ];
  let out = body;
  for (const [pattern, to] of swaps) out = out.replace(pattern, to);
  // Anything else still asking for the whole body
  out = out
    .replace(/head[- ]to[- ](?:toe|feet)(?: with margin)?/gi, span)
    .replace(/\bfull[- ]length\b/gi, "framed")
    .replace(/\bfull[- ]body\b/gi, span);
  return `${out}\n\nFRAMING (hard constraint — set for this product; overrides every other framing, crop, pose-reference crop and scene instruction above):\n${line}`;
}

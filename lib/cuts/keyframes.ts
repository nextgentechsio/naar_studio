import type { Clip, Ease, Keyframe, KeyframeProp, Transform } from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: KEYFRAMES
//
// A setting that changes over a clip: values at frames
// (counted from the clip's start), eased in between.
// Without keyframes the clip's own setting applies.
// --------------------------------------------------

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function blend(from: Keyframe, to: Keyframe, frame: number) {
  if (from.ease === "hold") return from.value;
  const t = (frame - from.frame) / (to.frame - from.frame);
  const eased = from.ease === "ease" ? easeInOut(t) : t;
  return from.value + (to.value - from.value) * eased;
}

// The value at `frame` (from the clip's start): held
// before the first key and after the last
export function valueAt(keys: Keyframe[] | undefined, frame: number, fallback: number): number {
  if (!keys?.length) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;

  for (let index = 1; index < keys.length; index++) {
    if (frame <= keys[index].frame) return blend(keys[index - 1], keys[index], frame);
  }
  return keys[keys.length - 1].value;
}

// The clip's own value of a keyframed setting
export function baseValue(clip: Clip, prop: KeyframeProp): number {
  return prop === "volume" ? clip.volume : clip.transform[prop as keyof Transform];
}

// Adds or replaces the key at `frame`, kept in order
export function setKey(keys: Keyframe[] | undefined, frame: number, value: number, ease: Ease = "ease"): Keyframe[] {
  const others = (keys ?? []).filter((key) => key.frame !== frame);
  return [...others, { frame, value, ease }].sort((a, b) => a.frame - b.frame);
}

export function removeKey(keys: Keyframe[] | undefined, frame: number): Keyframe[] {
  return (keys ?? []).filter((key) => key.frame !== frame);
}

// The clip's transform and volume at timeline `frame`
export function clipStateAt(clip: Clip, frame: number): Transform & { volume: number } {
  const local = frame - clip.start;
  const at = (prop: KeyframeProp) => valueAt(clip.keyframes[prop], local, baseValue(clip, prop));

  return {
    ...clip.transform,
    x: at("x"),
    y: at("y"),
    scale: at("scale"),
    rotation: at("rotation"),
    opacity: at("opacity"),
    volume: at("volume"),
  };
}

// 0…1 gain from the clip's fades at timeline `frame`
export function fadeGain(clip: Pick<Clip, "start" | "duration" | "fadeIn" | "fadeOut">, frame: number): number {
  const local = frame - clip.start;
  let gain = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) gain = Math.min(gain, Math.max(0, local / clip.fadeIn));
  const left = clip.duration - local;
  if (clip.fadeOut > 0 && left < clip.fadeOut) gain = Math.min(gain, Math.max(0, left / clip.fadeOut));
  return gain;
}

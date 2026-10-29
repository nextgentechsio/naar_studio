import { clipStateAt, fadeGain } from "@/lib/cuts/keyframes";
import {
  audibleTracks,
  clipEnd,
  sourceTime,
  transitionFrom,
  transitionSpan,
  type Clip,
  type Color,
  type Project,
  type TextStyle,
  type TransitionType,
} from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: WHAT'S ON SCREEN AND HEARD AT A FRAME
//
// Pure, and shared by the preview and the export, so the
// two always agree. Layers come bottom first (the bottom
// video track first; within a track, the outgoing clip
// of a transition under the incoming one).
// --------------------------------------------------

export type VisualLayer = {
  clip: Clip;
  kind: "video" | "image" | "text" | "solid";
  // Where in the file (videos), never before its start
  sourceTime: number;
  // Evaluated keyframes, transitions and text animation
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  crop: { left: number; right: number; top: number; bottom: number };
  color: Color;
  // Mix the result towards `dipColor` by `dip` (0–1)
  dip: number;
  dipColor: [number, number, number];
  // Wipe: only the part right of `revealFrom` (0–1 of the
  // frame's width) is shown
  revealFrom: number;
  text: (TextStyle & { visibleChars: number }) | null;
  fill: string | null;
};

export type AudioVoice = {
  clip: Clip;
  sourceTime: number;
  // Clip volume × fades × track volume × transitions
  gain: number;
};

// A transition in progress at `frame`: the clip coming
// in, the one going out (if any) and how far along (0–1)
type ActiveTransition = { incoming: Clip; outgoing: Clip | null; type: TransitionType; progress: number };

function activeTransitions(project: Project, frame: number): ActiveTransition[] {
  const active: ActiveTransition[] = [];
  for (const clip of project.clips) {
    const span = transitionSpan(clip);
    if (!span || frame < span.from || frame >= span.to) continue;
    active.push({
      incoming: clip,
      outgoing: transitionFrom(project, clip),
      type: clip.transition!.type,
      progress: (frame - span.from + 0.5) / (span.to - span.from),
    });
  }
  return active;
}

// How a transition shows its two clips at `progress`
function applyTransition(layer: VisualLayer, type: TransitionType, progress: number, incoming: boolean): VisualLayer {
  const p = Math.min(1, Math.max(0, progress));

  switch (type) {
    case "dissolve":
      return incoming ? { ...layer, opacity: layer.opacity * p } : layer;
    case "dip-black":
    case "dip-white": {
      const dipColor: [number, number, number] = type === "dip-black" ? [0, 0, 0] : [1, 1, 1];
      // Out to the colour by half way, then in from it
      if (incoming) {
        return p < 0.5 ? { ...layer, opacity: 0 } : { ...layer, dip: 1 - (p - 0.5) * 2, dipColor };
      }
      return p < 0.5 ? { ...layer, dip: p * 2, dipColor } : { ...layer, opacity: 0 };
    }
    case "wipe-left":
      return incoming ? { ...layer, revealFrom: 1 - p } : layer;
    case "slide-left":
      return incoming ? { ...layer, x: layer.x + (1 - p) } : { ...layer, x: layer.x - p };
    case "zoom":
      return incoming
        ? { ...layer, scale: layer.scale * (0.7 + 0.3 * p), opacity: layer.opacity * p }
        : { ...layer, scale: layer.scale * (1 + 0.25 * p), opacity: layer.opacity * (1 - p) };
  }
}

const TEXT_ANIMATION_SECONDS = 0.6;

// Titles move in and out over their first and last moments
function animateText(project: Project, layer: VisualLayer, frame: number): VisualLayer {
  const style = layer.clip.text;
  if (!style) return layer;

  const local = (frame - layer.clip.start) / project.fps;
  const left = (clipEnd(layer.clip) - frame) / project.fps;
  // Parts of a title that was cut skip the animation at the cut
  const inT = layer.clip.textIn === false ? 1 : Math.min(1, Math.max(0, local / TEXT_ANIMATION_SECONDS));
  const outT = layer.clip.textOut === false ? 1 : Math.min(1, Math.max(0, left / TEXT_ANIMATION_SECONDS));
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const characters = [...style.text].length;
  const next = { ...layer, text: { ...style, visibleChars: characters } };

  switch (style.animation) {
    case "fade":
      return { ...next, opacity: next.opacity * Math.min(ease(inT), ease(outT)) };
    case "rise":
      return { ...next, y: next.y + (1 - ease(inT)) * 0.06, opacity: next.opacity * Math.min(ease(inT), ease(outT)) };
    case "pop": {
      const overshoot = inT < 1 ? 1 + Math.sin(inT * Math.PI) * 0.12 : 1;
      return { ...next, scale: next.scale * ease(inT) * overshoot, opacity: next.opacity * ease(outT) };
    }
    case "typewriter": {
      // About 22 characters a second
      const shown = layer.clip.textIn === false ? characters : Math.min(characters, Math.floor(local * 22));
      return { ...next, text: { ...next.text, visibleChars: shown } };
    }
    default:
      return next;
  }
}

function baseLayer(project: Project, clip: Clip, frame: number): VisualLayer | null {
  if (clip.type === "audio") return null;
  const state = clipStateAt(clip, frame);
  const fade = fadeGain(clip, Math.min(Math.max(frame, clip.start), clipEnd(clip) - 1));

  const layer: VisualLayer = {
    clip,
    kind: clip.type,
    sourceTime: Math.max(0, sourceTime(project, clip, frame)),
    x: state.x,
    y: state.y,
    scale: state.scale,
    rotation: state.rotation,
    opacity: state.opacity * fade,
    crop: { left: state.cropLeft, right: state.cropRight, top: state.cropTop, bottom: state.cropBottom },
    color: clip.color,
    dip: 0,
    dipColor: [0, 0, 0],
    revealFrom: 0,
    text: null,
    fill: clip.fill,
  };

  return clip.type === "text" ? animateText(project, layer, frame) : layer;
}

export function layersAt(project: Project, frame: number): VisualLayer[] {
  const transitions = activeTransitions(project, frame);
  const layers: VisualLayer[] = [];

  // Bottom video track first
  const videoTracks = project.tracks.filter((track) => track.kind === "video" && !track.hidden).reverse();

  for (const track of videoTracks) {
    const here = project.clips.filter((clip) => clip.trackId === track.id);
    const shown: VisualLayer[] = [];

    for (const clip of here) {
      const inside = frame >= clip.start && frame < clipEnd(clip);
      const asIncoming = transitions.find((item) => item.incoming.id === clip.id);
      const asOutgoing = transitions.find((item) => item.outgoing?.id === clip.id);
      if (!inside && !asIncoming && !asOutgoing) continue;

      let layer = baseLayer(project, clip, frame);
      if (!layer) continue;
      if (asOutgoing) layer = applyTransition(layer, asOutgoing.type, asOutgoing.progress, false);
      if (asIncoming) layer = applyTransition(layer, asIncoming.type, asIncoming.progress, true);
      if (layer.opacity <= 0.001) continue;

      // The incoming clip of a transition goes on top
      if (asIncoming) shown.push(layer);
      else shown.unshift(layer);
    }

    layers.push(...shown);
  }

  return layers;
}

export function voicesAt(project: Project, frame: number): AudioVoice[] {
  const heard = audibleTracks(project);
  const trackVolume = new Map(project.tracks.map((track) => [track.id, track.volume]));
  const transitions = activeTransitions(project, frame);
  const voices: AudioVoice[] = [];

  for (const clip of project.clips) {
    const audible = clip.type === "audio" || (clip.type === "video" && !clip.audioMuted);
    if (!audible || !heard.has(clip.trackId)) continue;

    const inside = frame >= clip.start && frame < clipEnd(clip);
    const asIncoming = transitions.find((item) => item.incoming.id === clip.id);
    const asOutgoing = transitions.find((item) => item.outgoing?.id === clip.id);
    if (!inside && !asIncoming && !asOutgoing) continue;

    // Transitions cross-fade the sound too
    let gain = clipStateAt(clip, frame).volume * (trackVolume.get(clip.trackId) ?? 1);
    gain *= fadeGain(clip, Math.min(Math.max(frame, clip.start), clipEnd(clip) - 1));
    if (asIncoming) gain *= Math.min(1, asIncoming.progress);
    if (asOutgoing) gain *= Math.max(0, 1 - asOutgoing.progress);
    if (gain <= 0.0001) continue;

    voices.push({ clip, sourceTime: Math.max(0, sourceTime(project, clip, frame)), gain });
  }

  return voices;
}

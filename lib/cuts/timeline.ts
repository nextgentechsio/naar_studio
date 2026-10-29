// --------------------------------------------------
// NAAR CUTS: THE TIMELINE (pure: no DOM, no React)
//
// The project as plain JSON, saved whole to the server.
// Positions on the timeline are whole frames at the
// project's frame rate, so cuts land on frames; source
// positions (where a clip starts inside its file) are
// seconds, since files have their own frame rates.
//
// Every edit returns a new project and never changes the
// one it was given (undo keeps the old ones).
// --------------------------------------------------

export const TIMELINE_VERSION = 1;

export type TrackKind = "video" | "audio";

export type Track = {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  // Video tracks: not drawn
  hidden: boolean;
  // 0–2 (1 = as recorded)
  volume: number;
};

export type ClipType = "video" | "image" | "audio" | "text" | "solid";

export type Transform = {
  // Centre, as a share of the frame from its centre
  // (-0.5 … 0.5 is the frame's edge)
  x: number;
  y: number;
  scale: number;
  // Degrees, clockwise
  rotation: number;
  opacity: number;
  // Share of the source cut off each side (0–0.45)
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
};

export type ColorLook = "none" | "teal-orange" | "warm-film" | "cool-night" | "mono" | "faded" | "vivid";

export type Color = {
  // Stops (-3 … 3)
  exposure: number;
  // -1 … 1
  contrast: number;
  // 0 (grey) … 2
  saturation: number;
  // -1 (cool) … 1 (warm)
  temperature: number;
  // -1 (green) … 1 (magenta)
  tint: number;
  // -1 … 1
  highlights: number;
  shadows: number;
  // 0 … 1
  vignette: number;
  look: ColorLook;
  // 0 … 1
  lookAmount: number;
};

export type TextStyle = {
  text: string;
  font: string;
  weight: number;
  // Height of a line as a share of the frame's height
  size: number;
  color: string;
  align: "left" | "center" | "right";
  // 0 = none; share of the font size
  stroke: number;
  strokeColor: string;
  shadow: boolean;
  // A box behind the text ("" = none)
  background: string;
  animation: "none" | "fade" | "rise" | "pop" | "typewriter";
};

export type TransitionType = "dissolve" | "dip-black" | "dip-white" | "wipe-left" | "slide-left" | "zoom";

// Into this clip from the one before it on the track
// (or from nothing: a fade in), centred on the cut
export type Transition = { type: TransitionType; duration: number };

export const KEYFRAME_PROPS = ["x", "y", "scale", "rotation", "opacity", "volume"] as const;
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

export type Ease = "linear" | "ease" | "hold";

// `frame` counts from the clip's own start
export type Keyframe = { frame: number; value: number; ease: Ease };

export type Clip = {
  id: string;
  trackId: string;
  type: ClipType;
  // The project's file (video, image, audio)
  assetId: string | null;
  // On the timeline, in frames
  start: number;
  duration: number;
  // Where in the file it starts (seconds)
  offset: number;
  // 0.25 – 4
  speed: number;
  // 0–2, and fades in frames
  volume: number;
  fadeIn: number;
  fadeOut: number;
  // A video's own sound (detached audio mutes it)
  audioMuted: boolean;
  transform: Transform;
  color: Color;
  keyframes: Partial<Record<KeyframeProp, Keyframe[]>>;
  transition: Transition | null;
  text: TextStyle | null;
  // Solid colour clips
  fill: string | null;
  // Shown on the clip
  name: string;
  // Titles: whether this clip plays the entrance and exit
  // animations (a title cut in two keeps one of each)
  textIn?: boolean;
  textOut?: boolean;
};

export type Marker = { id: string; frame: number; label: string; color: string };

export type Project = {
  version: typeof TIMELINE_VERSION;
  fps: number;
  width: number;
  height: number;
  background: string;
  // Top to bottom as shown: video tracks first (the top
  // one is drawn last, over the others), then audio
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
};

// What the timeline knows about a file
export type AssetInfo = {
  kind: "video" | "image" | "audio" | "export";
  // Null when unknown (not measured yet): not limited
  durationSeconds: number | null;
};

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const IMAGE_DEFAULT_SECONDS = 5;
export const TEXT_DEFAULT_SECONDS = 4;

// ---------- Ids ----------

let idCounter = 0;

export function newId(prefix: string) {
  idCounter = (idCounter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

// ---------- Defaults ----------

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
};

export const DEFAULT_COLOR: Color = {
  exposure: 0,
  contrast: 0,
  saturation: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vignette: 0,
  look: "none",
  lookAmount: 1,
};

export const DEFAULT_TEXT: TextStyle = {
  text: "Your title",
  font: "Inter, system-ui, sans-serif",
  weight: 700,
  size: 0.09,
  color: "#ffffff",
  align: "center",
  stroke: 0,
  strokeColor: "#000000",
  shadow: true,
  background: "",
  animation: "fade",
};

export function emptyProject(fps = 30, width = 1920, height = 1080): Project {
  return {
    version: TIMELINE_VERSION,
    fps,
    width,
    height,
    background: "#000000",
    tracks: [
      newTrack("video", "V2"),
      newTrack("video", "V1"),
      newTrack("audio", "A1"),
      newTrack("audio", "A2"),
    ],
    clips: [],
    markers: [],
  };
}

export function newTrack(kind: TrackKind, name: string): Track {
  return { id: newId("t"), kind, name, muted: false, solo: false, locked: false, hidden: false, volume: 1 };
}

// A clip of `type` with every setting at its default
export function newClip(fields: Pick<Clip, "trackId" | "type" | "start" | "duration"> & Partial<Clip>): Clip {
  return {
    id: newId("c"),
    assetId: null,
    offset: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    audioMuted: false,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    keyframes: {},
    transition: null,
    text: fields.type === "text" ? { ...DEFAULT_TEXT } : null,
    fill: fields.type === "solid" ? "#101014" : null,
    name: "",
    ...fields,
  };
}

// A saved timeline, or a fresh one when there's none (or
// it's from a format this editor doesn't know)
export function readProject(value: unknown): Project {
  const project = value as Partial<Project> | null;

  if (
    !project ||
    project.version !== TIMELINE_VERSION ||
    !Array.isArray(project.tracks) ||
    !Array.isArray(project.clips)
  ) {
    return emptyProject();
  }

  return {
    ...emptyProject(project.fps, project.width, project.height),
    ...project,
    markers: Array.isArray(project.markers) ? project.markers : [],
    // Settings added later get their defaults
    clips: project.clips.map((clip) => ({
      ...newClip(clip),
      ...clip,
      transform: { ...DEFAULT_TRANSFORM, ...clip.transform },
      color: { ...DEFAULT_COLOR, ...clip.color },
      text: clip.text ? { ...DEFAULT_TEXT, ...clip.text } : clip.type === "text" ? { ...DEFAULT_TEXT } : null,
    })),
  } as Project;
}

// ---------- Reading ----------

export const clipEnd = (clip: Pick<Clip, "start" | "duration">) => clip.start + clip.duration;

export function projectDuration(project: Project): number {
  return project.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
}

export function trackOf(project: Project, trackId: string) {
  return project.tracks.find((track) => track.id === trackId) ?? null;
}

export function clipsOnTrack(project: Project, trackId: string, except?: Set<string>) {
  return project.clips
    .filter((clip) => clip.trackId === trackId && !except?.has(clip.id))
    .sort((a, b) => a.start - b.start);
}

export const framesToSeconds = (project: Pick<Project, "fps">, frames: number) => frames / project.fps;
export const secondsToFrames = (project: Pick<Project, "fps">, seconds: number) => Math.round(seconds * project.fps);

// Where in its file a clip is at timeline `frame`
export function sourceTime(project: Pick<Project, "fps">, clip: Clip, frame: number): number {
  return clip.offset + ((frame - clip.start) / project.fps) * clip.speed;
}

// Longest a clip may run from `offset` at `speed` (null:
// no limit, e.g. images, titles, or not measured yet)
export function maxDuration(
  project: Pick<Project, "fps">,
  clip: Pick<Clip, "type" | "offset" | "speed">,
  asset: AssetInfo | null
): number | null {
  if (clip.type !== "video" && clip.type !== "audio") return null;
  if (!asset?.durationSeconds) return null;
  const seconds = Math.max(0, asset.durationSeconds - clip.offset) / clip.speed;
  return Math.max(1, Math.floor(seconds * project.fps + 1e-6));
}

// Which track kind a clip type belongs on
export const trackKindFor = (type: ClipType): TrackKind => (type === "audio" ? "audio" : "video");

// Tracks whose sound is heard: solo wins over mute
export function audibleTracks(project: Project): Set<string> {
  const soloed = project.tracks.filter((track) => track.solo);
  const heard = soloed.length ? soloed : project.tracks.filter((track) => !track.muted);
  return new Set(heard.map((track) => track.id));
}

// ---------- Editing ----------

function replaceClips(project: Project, clips: Clip[]): Project {
  return { ...project, clips };
}

export function updateClip(project: Project, id: string, patch: Partial<Clip>): Project {
  return replaceClips(
    project,
    project.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip))
  );
}

// Clears [from, to) on a track for a clip being dropped
// there (as an NLE's overwrite edit): clips under it are
// trimmed, split or removed. Clips in `except` stay.
export function clearRange(project: Project, trackId: string, from: number, to: number, except?: Set<string>): Project {
  const clips: Clip[] = [];

  for (const clip of project.clips) {
    const end = clipEnd(clip);

    if (clip.trackId !== trackId || except?.has(clip.id) || end <= from || clip.start >= to) {
      clips.push(clip);
      continue;
    }

    // The part before the range
    if (clip.start < from) {
      clips.push(withRange(project, clip, clip.start, from));
    }
    // The part after it (a new clip when both remain)
    if (end > to) {
      const after = withRange(project, clip, to, end);
      clips.push(clip.start < from ? { ...after, id: newId("c"), transition: null } : after);
    }
  }

  return replaceClips(project, clips);
}

// The same clip, cut down to [from, to) of where it is:
// its file offset and keyframes follow
function withRange(project: Pick<Project, "fps">, clip: Clip, from: number, to: number): Clip {
  const shift = from - clip.start;
  return {
    ...clip,
    start: from,
    duration: to - from,
    offset: clip.type === "video" || clip.type === "audio" ? clip.offset + (shift / project.fps) * clip.speed : clip.offset,
    fadeIn: shift > 0 ? 0 : clip.fadeIn,
    fadeOut: to < clipEnd(clip) ? 0 : clip.fadeOut,
    textIn: shift > 0 ? false : clip.textIn,
    textOut: to < clipEnd(clip) ? false : clip.textOut,
    transition: shift > 0 ? null : clip.transition,
    keyframes: shiftKeyframes(clip.keyframes, -shift, to - from),
  };
}

function shiftKeyframes(keyframes: Clip["keyframes"], by: number, length: number): Clip["keyframes"] {
  if (!by && Object.values(keyframes).every((list) => list?.every((key) => key.frame <= length))) return keyframes;

  const shifted: Clip["keyframes"] = {};
  for (const prop of KEYFRAME_PROPS) {
    const list = keyframes[prop];
    if (!list?.length) continue;
    const kept = list.map((key) => ({ ...key, frame: key.frame + by })).filter((key) => key.frame >= 0 && key.frame <= length);
    if (kept.length) shifted[prop] = kept;
  }
  return shifted;
}

// Puts a new clip on the timeline, over whatever was there
export function insertClip(project: Project, clip: Clip): Project {
  const cleared = clearRange(project, clip.trackId, clip.start, clipEnd(clip));
  return replaceClips(cleared, [...cleared.clips, clip]);
}

// Moves clips by `frames` (and onto another track when
// given: the first clip's track, the others keep their
// distance in rows), overwriting what's underneath
export function moveClips(
  project: Project,
  ids: string[],
  frames: number,
  trackShift = 0
): Project {
  const moving = new Set(ids);
  const selected = project.clips.filter((clip) => moving.has(clip.id));
  if (!selected.length) return project;

  // Never before the start of the timeline
  const earliest = Math.min(...selected.map((clip) => clip.start));
  const by = Math.max(frames, -earliest);

  const moved = selected.map((clip) => {
    const track = trackOf(project, clip.trackId);
    const target = track ? shiftTrack(project, track, trackShift) : null;
    return { ...clip, start: clip.start + by, trackId: target?.id ?? clip.trackId };
  });

  let next = project;
  for (const clip of moved) next = clearRange(next, clip.trackId, clip.start, clipEnd(clip), moving);

  const byId = new Map(moved.map((clip) => [clip.id, clip]));
  return replaceClips(next, next.clips.map((clip) => byId.get(clip.id) ?? clip));
}

// The track `rows` away of the same kind (video clips stay
// on video tracks), or the nearest one in that direction
function shiftTrack(project: Project, track: Track, rows: number): Track {
  if (!rows) return track;
  const same = project.tracks.filter((item) => item.kind === track.kind);
  const index = same.findIndex((item) => item.id === track.id);
  return same[Math.min(same.length - 1, Math.max(0, index + rows))];
}

// Neighbours that stop a trim: the nearest clip edges on
// either side on the same track
function neighbours(project: Project, clip: Clip) {
  const others = clipsOnTrack(project, clip.trackId, new Set([clip.id]));
  const before = others.filter((other) => clipEnd(other) <= clip.start).pop();
  const after = others.find((other) => other.start >= clipEnd(clip));
  return { before: before ? clipEnd(before) : 0, after: after ? after.start : Infinity };
}

// Moves a clip's start edge to `frame` (its end stays):
// limited by the clip before it, the file's start and a
// one-frame minimum
export function trimStart(project: Project, id: string, frame: number): Project {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return project;

  const end = clipEnd(clip);
  const { before } = neighbours(project, clip);
  const timed = clip.type === "video" || clip.type === "audio";
  // How far back the file allows (its start)
  const earliestBySource = timed ? clip.start - Math.floor((clip.offset / clip.speed) * project.fps + 1e-6) : -Infinity;
  const start = Math.min(end - 1, Math.max(frame, before, earliestBySource, 0));
  const shift = start - clip.start;

  return updateClip(project, id, {
    start,
    duration: end - start,
    offset: timed ? Math.max(0, clip.offset + (shift / project.fps) * clip.speed) : clip.offset,
    keyframes: shiftKeyframes(clip.keyframes, -shift, end - start),
  });
}

// Moves a clip's end edge to `frame`: limited by the
// next clip, the file's end and a one-frame minimum
export function trimEnd(project: Project, id: string, frame: number, asset: AssetInfo | null): Project {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return project;

  const { after } = neighbours(project, clip);
  const longest = maxDuration(project, clip, asset);
  const end = Math.max(clip.start + 1, Math.min(frame, after, longest === null ? Infinity : clip.start + longest));

  return updateClip(project, id, {
    duration: end - clip.start,
    keyframes: shiftKeyframes(clip.keyframes, 0, end - clip.start),
  });
}

// Cuts a clip in two at `frame` (the blade). The right
// part is a new clip; returns its id too.
export function splitClip(project: Project, id: string, frame: number): { project: Project; rightId: string | null } {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip || frame <= clip.start || frame >= clipEnd(clip)) return { project, rightId: null };

  const left = withRange(project, clip, clip.start, frame);
  const right = { ...withRange(project, clip, frame, clipEnd(clip)), id: newId("c") };

  return {
    project: replaceClips(
      project,
      project.clips.flatMap((item) => (item.id === id ? [left, right] : [item]))
    ),
    rightId: right.id,
  };
}

// The blade on every unlocked track at `frame` (or only
// on the given clips)
export function splitAt(project: Project, frame: number, onlyIds?: string[]): Project {
  const locked = new Set(project.tracks.filter((track) => track.locked).map((track) => track.id));
  const targets = project.clips.filter(
    (clip) =>
      !locked.has(clip.trackId) &&
      clip.start < frame &&
      clipEnd(clip) > frame &&
      (!onlyIds || onlyIds.includes(clip.id))
  );

  let next = project;
  for (const clip of targets) next = splitClip(next, clip.id, frame).project;
  return next;
}

// Removes clips. Ripple: later clips on the same tracks
// close the gap.
export function deleteClips(project: Project, ids: string[], ripple = false): Project {
  const removing = new Set(ids);
  const removed = project.clips.filter((clip) => removing.has(clip.id));
  let clips = project.clips.filter((clip) => !removing.has(clip.id));

  if (ripple) {
    // Latest first, so earlier gaps shift what's after them
    for (const gone of [...removed].sort((a, b) => b.start - a.start)) {
      clips = clips.map((clip) =>
        clip.trackId === gone.trackId && clip.start >= clipEnd(gone)
          ? { ...clip, start: clip.start - gone.duration }
          : clip
      );
    }
  }

  return replaceClips(project, clips);
}

// Copies placed right after the originals, on their tracks
export function duplicateClips(project: Project, ids: string[]): { project: Project; ids: string[] } {
  const originals = project.clips.filter((clip) => ids.includes(clip.id));
  if (!originals.length) return { project, ids: [] };

  const span = Math.max(...originals.map(clipEnd)) - Math.min(...originals.map((clip) => clip.start));
  let next = project;
  const created: string[] = [];

  for (const clip of originals) {
    const copy = { ...clip, id: newId("c"), start: clip.start + span };
    next = insertClip(next, copy);
    created.push(copy.id);
  }

  return { project: next, ids: created };
}

// Plays the clip at `speed`: its length changes so the
// same stretch of the file is shown
export function setSpeed(project: Project, id: string, speed: number, asset: AssetInfo | null): Project {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return project;

  const next = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  const sourceSeconds = (clip.duration / project.fps) * clip.speed;
  let duration = Math.max(1, Math.round((sourceSeconds / next) * project.fps));

  const longest = maxDuration(project, { ...clip, speed: next }, asset);
  if (longest !== null) duration = Math.min(duration, longest);
  const { after } = neighbours(project, clip);
  duration = Math.min(duration, after - clip.start);

  return updateClip(project, id, { speed: next, duration });
}

// A video clip's sound as its own clip on an audio track
// (the video goes quiet), so it can be moved and mixed
export function detachAudio(project: Project, id: string): { project: Project; audioId: string | null } {
  const clip = project.clips.find((item) => item.id === id);
  const track = project.tracks.find((item) => item.kind === "audio" && !item.locked);
  if (!clip || clip.type !== "video" || clip.audioMuted || !track) return { project, audioId: null };

  const audio = newClip({
    trackId: track.id,
    type: "audio",
    assetId: clip.assetId,
    start: clip.start,
    duration: clip.duration,
    offset: clip.offset,
    speed: clip.speed,
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    name: clip.name,
  });

  const muted = updateClip(project, id, { audioMuted: true });
  return { project: insertClip(muted, audio), audioId: audio.id };
}

// The project at another frame rate: positions and
// lengths in frames scale with it
export function withFrameRate(project: Project, fps: number): Project {
  if (fps === project.fps) return project;
  const ratio = fps / project.fps;
  const scale = (frames: number) => Math.round(frames * ratio);
  return {
    ...project,
    fps,
    markers: project.markers.map((marker) => ({ ...marker, frame: scale(marker.frame) })),
    clips: project.clips.map((clip) => ({
      ...clip,
      start: scale(clip.start),
      duration: Math.max(1, scale(clip.duration)),
      fadeIn: scale(clip.fadeIn),
      fadeOut: scale(clip.fadeOut),
      transition: clip.transition ? { ...clip.transition, duration: scale(clip.transition.duration) } : null,
      keyframes: Object.fromEntries(
        Object.entries(clip.keyframes).map(([prop, keys]) => [prop, keys?.map((key) => ({ ...key, frame: scale(key.frame) }))])
      ),
    })),
  };
}

// ---------- Tracks ----------

// The first unlocked track of `kind` with nothing in
// [from, to): V1 upwards for video, A1 downwards for
// audio. A new track is added when they're all busy.
export function freeTrack(project: Project, kind: TrackKind, from: number, to: number): { project: Project; trackId: string } {
  const tracks = project.tracks.filter((track) => track.kind === kind && !track.locked);
  const ordered = kind === "video" ? [...tracks].reverse() : tracks;
  const free = ordered.find(
    (track) => !project.clips.some((clip) => clip.trackId === track.id && clip.start < to && clipEnd(clip) > from)
  );
  if (free) return { project, trackId: free.id };

  const added = addTrack(project, kind);
  const track = kind === "video" ? added.tracks[0] : added.tracks[added.tracks.length - 1];
  return { project: added, trackId: track.id };
}

export function addTrack(project: Project, kind: TrackKind): Project {
  const count = project.tracks.filter((track) => track.kind === kind).length;
  const track = newTrack(kind, `${kind === "video" ? "V" : "A"}${count + 1}`);
  // New video tracks go on top; audio at the bottom
  return {
    ...project,
    tracks: kind === "video" ? [track, ...project.tracks] : [...project.tracks, track],
  };
}

export function updateTrack(project: Project, id: string, patch: Partial<Track>): Project {
  return { ...project, tracks: project.tracks.map((track) => (track.id === id ? { ...track, ...patch } : track)) };
}

// The track and its clips; the last of a kind stays
export function removeTrack(project: Project, id: string): Project {
  const track = trackOf(project, id);
  if (!track || project.tracks.filter((item) => item.kind === track.kind).length <= 1) return project;
  return {
    ...project,
    tracks: project.tracks.filter((item) => item.id !== id),
    clips: project.clips.filter((clip) => clip.trackId !== id),
  };
}

// ---------- Snapping ----------

// Frames worth snapping to: clip edges, the playhead,
// markers and the start
export function snapPoints(project: Project, playhead: number, except?: Set<string>): number[] {
  const points = new Set<number>([0, playhead]);
  for (const clip of project.clips) {
    if (except?.has(clip.id)) continue;
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  for (const marker of project.markers) points.add(marker.frame);
  return [...points];
}

// The nearest point within `threshold` frames, if any
export function snap(frame: number, points: number[], threshold: number): { frame: number; snapped: boolean } {
  let best = frame;
  let distance = threshold + 1;

  for (const point of points) {
    const gap = Math.abs(point - frame);
    if (gap < distance) {
      best = point;
      distance = gap;
    }
  }

  return distance <= threshold ? { frame: best, snapped: true } : { frame, snapped: false };
}

// Snaps a moving clip by whichever of its edges is
// closer to a point
export function snapMove(
  start: number,
  duration: number,
  points: number[],
  threshold: number
): { start: number; snapped: number | null } {
  const head = snap(start, points, threshold);
  const tail = snap(start + duration, points, threshold);
  const headGap = head.snapped ? Math.abs(head.frame - start) : Infinity;
  const tailGap = tail.snapped ? Math.abs(tail.frame - (start + duration)) : Infinity;

  if (headGap === Infinity && tailGap === Infinity) return { start, snapped: null };
  return headGap <= tailGap
    ? { start: head.frame, snapped: head.frame }
    : { start: tail.frame - duration, snapped: tail.frame };
}

// ---------- Transitions ----------

// The clip a transition into `clip` comes from: the one
// ending exactly where it starts, on the same track
export function transitionFrom(project: Project, clip: Clip): Clip | null {
  return project.clips.find((other) => other.trackId === clip.trackId && clipEnd(other) === clip.start) ?? null;
}

// A transition's span on the timeline: centred on the cut
export function transitionSpan(clip: Clip): { from: number; to: number } | null {
  if (!clip.transition || clip.transition.duration <= 0) return null;
  const half = Math.floor(clip.transition.duration / 2);
  return { from: clip.start - half, to: clip.start + clip.transition.duration - half };
}

import { describe, expect, it } from "vitest";
import {
  clipEnd,
  deleteClips,
  detachAudio,
  duplicateClips,
  emptyProject,
  insertClip,
  maxDuration,
  moveClips,
  newClip,
  projectDuration,
  readProject,
  removeTrack,
  setSpeed,
  snap,
  snapMove,
  snapPoints,
  sourceTime,
  splitAt,
  splitClip,
  transitionFrom,
  transitionSpan,
  trimEnd,
  trimStart,
  type Clip,
  type Project,
} from "@/lib/cuts/timeline";

// A 30 fps project with clips placed by hand
function setup(...clips: Partial<Clip>[]) {
  const base = emptyProject(30);
  const [v2, v1, a1] = base.tracks;
  const project: Project = {
    ...base,
    clips: clips.map((clip, index) =>
      newClip({ trackId: v1.id, type: "video", start: 0, duration: 30, id: `c${index}`, ...clip })
    ),
  };
  return { project, v1: v1.id, v2: v2.id, a1: a1.id };
}

const byId = (project: Project, id: string) => project.clips.find((clip) => clip.id === id)!;
const onTrack = (project: Project, trackId: string) =>
  project.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((clip) => [clip.start, clipEnd(clip)]);

const VIDEO_10S = { kind: "video" as const, durationSeconds: 10 };

describe("Naar Cuts timeline: placing clips", () => {
  it("overwrites what a new clip lands on: trims, splits and removes", () => {
    const { project, v1 } = setup({ start: 0, duration: 60 }, { start: 90, duration: 30 });

    // Lands in the middle of the first clip and over the second
    const next = insertClip(project, newClip({ trackId: v1, type: "image", start: 30, duration: 90 }));
    expect(onTrack(next, v1)).toEqual([
      [0, 30],
      [30, 120],
    ]);

    // Splitting keeps both outer parts, the right one a new clip
    const inside = insertClip(project, newClip({ trackId: v1, type: "image", start: 20, duration: 10 }));
    expect(onTrack(inside, v1)).toEqual([
      [0, 20],
      [20, 30],
      [30, 60],
      [90, 120],
    ]);
    const right = inside.clips.find((clip) => clip.start === 30)!;
    expect(right.id).not.toBe("c0");
    // Its file position follows the cut: 1 s in
    expect(right.offset).toBeCloseTo(1);
  });

  it("moves clips, never before zero, overwriting on the way", () => {
    const { project, v1, v2 } = setup({ start: 0, duration: 30 }, { start: 60, duration: 30 });

    // 0–30 moved to 45–75: the clip at 60–90 keeps 75–90
    const later = moveClips(project, ["c0"], 45);
    expect(onTrack(later, v1)).toEqual([
      [45, 75],
      [75, 90],
    ]);

    expect(byId(moveClips(project, ["c1"], -500), "c1").start).toBe(0);

    // Up a row: onto V2, the other video track
    const up = moveClips(project, ["c0"], 0, -1);
    expect(byId(up, "c0").trackId).toBe(v2);
  });

  it("keeps video clips off audio tracks when moving rows", () => {
    const { project, v1 } = setup({ start: 0, duration: 30 });
    // Further down than there are video tracks: stays on the last one
    expect(byId(moveClips(project, ["c0"], 0, 5), "c0").trackId).toBe(v1);
  });
});

describe("Naar Cuts timeline: trimming and cutting", () => {
  it("trims the start: the file offset and keyframes follow", () => {
    const { project } = setup({
      start: 30,
      duration: 60,
      offset: 2,
      keyframes: { opacity: [{ frame: 0, value: 0, ease: "linear" }, { frame: 30, value: 1, ease: "linear" }] },
    });

    const trimmed = byId(trimStart(project, "c0", 45), "c0");
    expect(trimmed).toMatchObject({ start: 45, duration: 45 });
    expect(trimmed.offset).toBeCloseTo(2.5);
    expect(trimmed.keyframes.opacity).toEqual([{ frame: 15, value: 1, ease: "linear" }]);

    // To the timeline's start: 30 frames = 1 s further back in the file
    expect(byId(trimStart(project, "c0", 0), "c0")).toMatchObject({ start: 0, duration: 90, offset: 1 });
    // Further back than the file allows: stops at the file's start (2 s = 60 frames)
    const late = setup({ start: 100, duration: 30, offset: 2 }).project;
    expect(byId(trimStart(late, "c0", 0), "c0")).toMatchObject({ start: 40, duration: 90, offset: 0 });
  });

  it("trims the end up to the next clip and the file's end", () => {
    const { project } = setup({ start: 0, duration: 60, offset: 8 }, { start: 200, duration: 30 });
    // 2 s of file left = 60 frames
    expect(byId(trimEnd(project, "c0", 150, VIDEO_10S), "c0").duration).toBe(60);
    // Unknown length: up to the next clip
    expect(byId(trimEnd(project, "c0", 500, null), "c0").duration).toBe(200);
    // Never under a frame
    expect(byId(trimEnd(project, "c0", -10, null), "c0").duration).toBe(1);
  });

  it("splits a clip at a frame into two that play on seamlessly", () => {
    const { project } = setup({ start: 10, duration: 60, offset: 1, speed: 2, fadeIn: 5, fadeOut: 5 });
    const { project: next, rightId } = splitClip(project, "c0", 40);
    const left = byId(next, "c0");
    const right = byId(next, rightId!);

    expect([left.start, left.duration, right.start, right.duration]).toEqual([10, 30, 40, 30]);
    // 30 frames at 2× = 2 s further into the file
    expect(right.offset).toBeCloseTo(3);
    expect(sourceTime(next, right, 40)).toBeCloseTo(sourceTime(project, byId(project, "c0"), 40));
    // Fades stay at the outer ends
    expect([left.fadeIn, left.fadeOut, right.fadeIn, right.fadeOut]).toEqual([5, 0, 0, 5]);

    expect(splitClip(project, "c0", 10).rightId).toBeNull();
    expect(splitClip(project, "c0", 70).rightId).toBeNull();
  });

  it("blades every unlocked track at the playhead", () => {
    const { project, v1, v2 } = setup({ start: 0, duration: 60 }, { start: 0, duration: 60 });
    const twoTracks = { ...project, clips: project.clips.map((clip, index) => ({ ...clip, trackId: index ? v2 : v1 })) };
    const locked = { ...twoTracks, tracks: twoTracks.tracks.map((track) => (track.id === v2 ? { ...track, locked: true } : track)) };

    expect(splitAt(twoTracks, 20).clips).toHaveLength(4);
    expect(splitAt(locked, 20).clips).toHaveLength(3);
  });

  it("ripple delete closes the gap on that track only", () => {
    const { project, v1, v2 } = setup(
      { start: 0, duration: 30 },
      { start: 30, duration: 30 },
      { start: 60, duration: 30 }
    );
    const withOther = insertClip(project, newClip({ trackId: v2, type: "image", start: 60, duration: 30, id: "other" }));

    const rippled = deleteClips(withOther, ["c1"], true);
    expect(onTrack(rippled, v1)).toEqual([
      [0, 30],
      [30, 60],
    ]);
    expect(byId(rippled, "other").start).toBe(60);

    expect(onTrack(deleteClips(withOther, ["c1"]), v1)).toEqual([
      [0, 30],
      [60, 90],
    ]);
  });

  it("duplicates after the originals, and changes speed keeping the same footage", () => {
    const { project } = setup({ start: 0, duration: 60 });
    const { project: doubled, ids } = duplicateClips(project, ["c0"]);
    expect(byId(doubled, ids[0]).start).toBe(60);

    const fast = byId(setSpeed(project, "c0", 2, VIDEO_10S), "c0");
    expect([fast.speed, fast.duration]).toEqual([2, 30]);
    const slow = byId(setSpeed(project, "c0", 0.5, VIDEO_10S), "c0");
    expect([slow.speed, slow.duration]).toEqual([0.5, 120]);
    expect(byId(setSpeed(project, "c0", 99, null), "c0").speed).toBe(4);
  });

  it("detaches a video's sound onto an audio track", () => {
    const { project, a1 } = setup({ start: 15, duration: 45, offset: 1, assetId: "asset-1" });
    const { project: next, audioId } = detachAudio(project, "c0");
    expect(byId(next, "c0").audioMuted).toBe(true);
    expect(byId(next, audioId!)).toMatchObject({ type: "audio", trackId: a1, start: 15, duration: 45, offset: 1, assetId: "asset-1" });
    // Only once
    expect(detachAudio(next, "c0").audioId).toBeNull();
  });
});

describe("Naar Cuts timeline: reading", () => {
  it("knows lengths and source times", () => {
    const { project } = setup({ start: 30, duration: 90 }, { start: 0, duration: 15 });
    expect(projectDuration(project)).toBe(120);
    expect(sourceTime(project, byId(project, "c0"), 60)).toBeCloseTo(1);
    expect(maxDuration(project, { type: "video", offset: 4, speed: 1 }, VIDEO_10S)).toBe(180);
    expect(maxDuration(project, { type: "image", offset: 0, speed: 1 }, VIDEO_10S)).toBeNull();
  });

  it("snaps to the nearest edge within reach", () => {
    const { project } = setup({ start: 0, duration: 30 }, { start: 100, duration: 20 });
    const points = snapPoints(project, 55, new Set(["c1"]));
    expect(points).toEqual(expect.arrayContaining([0, 30, 55]));
    expect(snap(33, points, 4)).toEqual({ frame: 30, snapped: true });
    expect(snap(42, points, 4)).toEqual({ frame: 42, snapped: false });
    // A clip's tail snapping to the playhead
    expect(snapMove(40, 14, points, 3)).toEqual({ start: 41, snapped: 55 });
  });

  it("finds a transition's outgoing clip and its span around the cut", () => {
    const { project } = setup(
      { start: 0, duration: 30 },
      { start: 30, duration: 30, transition: { type: "dissolve", duration: 10 } }
    );
    expect(transitionFrom(project, byId(project, "c1"))?.id).toBe("c0");
    expect(transitionFrom(project, byId(project, "c0"))).toBeNull();
    expect(transitionSpan(byId(project, "c1"))).toEqual({ from: 25, to: 35 });
  });

  it("reads saved projects, filling in settings added later", () => {
    const { project } = setup({ start: 0, duration: 30 });
    const saved = JSON.parse(JSON.stringify(project));
    delete saved.clips[0].color.vignette;
    const read = readProject(saved);
    expect(read.clips[0].color.vignette).toBe(0);
    expect(readProject(null).tracks).toHaveLength(4);
    expect(readProject({ version: 99 }).clips).toEqual([]);
  });

  it("keeps the last track of each kind", () => {
    const { project, v1, v2 } = setup();
    const one = removeTrack(project, v2);
    expect(one.tracks.filter((track) => track.kind === "video")).toHaveLength(1);
    expect(removeTrack(one, v1)).toBe(one);
  });
});

import { describe, expect, it } from "vitest";
import { layersAt, voicesAt } from "@/lib/cuts/frame";
import { emptyProject, newClip, splitClip, type Clip, type Project } from "@/lib/cuts/timeline";

function setup(build: (tracks: { v1: string; v2: string; a1: string }) => Partial<Clip>[]) {
  const base = emptyProject(30);
  const [v2, v1, a1] = base.tracks;
  const ids = { v1: v1.id, v2: v2.id, a1: a1.id };
  const project: Project = {
    ...base,
    clips: build(ids).map((clip, index) =>
      newClip({ trackId: ids.v1, type: "video", start: 0, duration: 30, id: `c${index}`, ...clip })
    ),
  };
  return { project, ...ids };
}

const ids = (layers: { clip: Clip }[]) => layers.map((layer) => layer.clip.id);

describe("Naar Cuts frames: what's on screen", () => {
  it("stacks the bottom track first and skips hidden tracks", () => {
    const { project, v2 } = setup(({ v2 }) => [{ start: 0 }, { start: 0, trackId: v2, type: "text" }]);
    expect(ids(layersAt(project, 10))).toEqual(["c0", "c1"]);

    const hidden = { ...project, tracks: project.tracks.map((track) => (track.id === v2 ? { ...track, hidden: true } : track)) };
    expect(ids(layersAt(hidden, 10))).toEqual(["c0"]);
    expect(layersAt(project, 30)).toEqual([]);
  });

  it("shows where in the file each video is, with speed", () => {
    const { project } = setup(() => [{ start: 30, duration: 60, offset: 2, speed: 2 }]);
    expect(layersAt(project, 45)[0].sourceTime).toBeCloseTo(3);
  });

  it("cross-dissolves around the cut, both clips showing", () => {
    const { project } = setup(() => [
      { start: 0, duration: 30 },
      { start: 30, duration: 30, transition: { type: "dissolve", duration: 10 } },
    ]);

    // Before the transition: only the first clip
    expect(ids(layersAt(project, 20))).toEqual(["c0"]);
    // Inside it: outgoing under incoming, incoming fading in
    const middle = layersAt(project, 30);
    expect(ids(middle)).toEqual(["c0", "c1"]);
    expect(middle[1].opacity).toBeCloseTo(0.55);
    // The incoming clip holds its first frame before its start
    expect(layersAt(project, 26)[1].sourceTime).toBe(0);
    expect(ids(layersAt(project, 40))).toEqual(["c1"]);
  });

  it("dips through black, slides and wipes", () => {
    const dip = setup(() => [
      { start: 0, duration: 30 },
      { start: 30, duration: 30, transition: { type: "dip-black", duration: 10 } },
    ]).project;
    const first = layersAt(dip, 27);
    expect(ids(first)).toEqual(["c0"]);
    // A quarter through: half way down to black
    expect(first[0].dip).toBeCloseTo(0.5);
    expect(layersAt(dip, 34)[0].dip).toBeLessThan(0.2);

    const wipe = setup(() => [
      { start: 0, duration: 30 },
      { start: 30, duration: 30, transition: { type: "wipe-left", duration: 10 } },
    ]).project;
    expect(layersAt(wipe, 30)[1].revealFrom).toBeCloseTo(0.45);
  });

  it("fades and animates titles", () => {
    const { project } = setup(() => [
      { type: "text", start: 0, duration: 90, fadeIn: 0 },
    ]);
    const typed = {
      ...project,
      clips: project.clips.map((clip) => ({ ...clip, text: { ...clip.text!, text: "Hello world", animation: "typewriter" as const } })),
    };
    expect(layersAt(typed, 6)[0].text?.visibleChars).toBe(4);
    expect(layersAt(typed, 80)[0].text?.visibleChars).toBe(11);

    const faded = layersAt(project, 3)[0];
    expect(faded.opacity).toBeGreaterThan(0);
    expect(faded.opacity).toBeLessThan(1);

    // Cut in two: no fade out and back in at the cut
    const { project: cut, rightId } = splitClip(project, "c0", 45);
    expect(layersAt(cut, 44)[0].opacity).toBe(1);
    expect(layersAt(cut, 45)[0].clip.id).toBe(rightId);
    expect(layersAt(cut, 45)[0].opacity).toBe(1);
    expect(layersAt(cut, 88)[0].opacity).toBeLessThan(1);
  });
});

describe("Naar Cuts frames: what's heard", () => {
  it("mixes clip and track volume, fades, mute and solo", () => {
    const { project, a1 } = setup(({ a1 }) => [
      { start: 0, duration: 60, volume: 0.5 },
      { type: "audio", trackId: a1, start: 0, duration: 60, fadeIn: 20 },
      { start: 0, duration: 60, audioMuted: true },
    ]);

    const voices = voicesAt(project, 10);
    expect(ids(voices)).toEqual(["c0", "c1"]);
    expect(voices[0].gain).toBeCloseTo(0.5);
    expect(voices[1].gain).toBeCloseTo(0.5);

    const soloed = { ...project, tracks: project.tracks.map((track) => (track.id === a1 ? { ...track, solo: true } : track)) };
    expect(ids(voicesAt(soloed, 10))).toEqual(["c1"]);
    const muted = { ...project, tracks: project.tracks.map((track) => (track.id === a1 ? { ...track, muted: true } : track)) };
    expect(ids(voicesAt(muted, 30))).toEqual(["c0"]);
  });

  it("cross-fades sound across a transition", () => {
    const { project } = setup(() => [
      { start: 0, duration: 30 },
      { start: 30, duration: 30, transition: { type: "dissolve", duration: 10 } },
    ]);
    const [outgoing, incoming] = voicesAt(project, 30);
    expect(outgoing.gain + incoming.gain).toBeCloseTo(1);
  });
});

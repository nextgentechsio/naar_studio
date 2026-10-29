import { describe, expect, it } from "vitest";
import { balanceGains, gradePixel, isNeutral, lookMatrix } from "@/lib/cuts/color";
import { push, redo, seal, startHistory, undo, HISTORY_LIMIT } from "@/lib/cuts/history";
import { clipStateAt, fadeGain, removeKey, setKey, valueAt } from "@/lib/cuts/keyframes";
import { DEFAULT_COLOR, newClip } from "@/lib/cuts/timeline";

describe("Naar Cuts keyframes", () => {
  const keys = [
    { frame: 0, value: 0, ease: "linear" as const },
    { frame: 10, value: 1, ease: "hold" as const },
    { frame: 20, value: 0, ease: "ease" as const },
    { frame: 30, value: 1, ease: "linear" as const },
  ];

  it("interpolates, holds, and eases between keys", () => {
    expect(valueAt(keys, -5, 9)).toBe(0);
    expect(valueAt(keys, 5, 9)).toBeCloseTo(0.5);
    // Hold: stays until the next key
    expect(valueAt(keys, 15, 9)).toBe(1);
    // Ease: slow at both ends, half way in the middle
    expect(valueAt(keys, 25, 9)).toBeCloseTo(0.5);
    expect(valueAt(keys, 21, 9)).toBeLessThan(0.1);
    expect(valueAt(keys, 99, 9)).toBe(1);
    expect(valueAt(undefined, 5, 9)).toBe(9);
  });

  it("adds, replaces and removes keys in order", () => {
    const added = setKey([{ frame: 10, value: 1, ease: "ease" }], 5, 0.5);
    expect(added.map((key) => key.frame)).toEqual([5, 10]);
    expect(setKey(added, 5, 0.7).find((key) => key.frame === 5)?.value).toBe(0.7);
    expect(removeKey(added, 5).map((key) => key.frame)).toEqual([10]);
  });

  it("gives a clip's transform and fades at a timeline frame", () => {
    const clip = newClip({
      trackId: "t",
      type: "video",
      start: 100,
      duration: 50,
      fadeIn: 10,
      fadeOut: 20,
      keyframes: { scale: [{ frame: 0, value: 1, ease: "linear" }, { frame: 10, value: 2, ease: "linear" }] },
    });
    expect(clipStateAt(clip, 105)).toMatchObject({ scale: 1.5, opacity: 1, volume: 1 });
    expect(fadeGain(clip, 100)).toBe(0);
    expect(fadeGain(clip, 105)).toBeCloseTo(0.5);
    expect(fadeGain(clip, 120)).toBe(1);
    expect(fadeGain(clip, 140)).toBeCloseTo(0.5);
  });
});

describe("Naar Cuts undo", () => {
  it("undoes and redoes, merging one gesture into one step", () => {
    let history = startHistory(0);
    history = push(history, 1);
    history = push(history, 2, "drag");
    history = push(history, 3, "drag");
    history = push(history, 4, "drag");
    expect(history.past).toEqual([0, 1]);

    history = seal(history);
    history = push(history, 5, "drag");
    expect(history.past).toEqual([0, 1, 4]);

    history = undo(undo(history));
    expect(history.present).toBe(1);
    history = redo(history);
    expect(history.present).toBe(4);

    // A new edit drops what could be redone
    history = push(history, 9);
    expect(history.future).toEqual([]);
    expect(undo(startHistory(7)).present).toBe(7);
  });

  it("keeps a bounded history", () => {
    let history = startHistory(0);
    for (let index = 1; index <= HISTORY_LIMIT + 50; index++) history = push(history, index);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("Naar Cuts color", () => {
  it("leaves pixels alone at neutral settings", () => {
    expect(isNeutral(DEFAULT_COLOR)).toBe(true);
    const [r, g, b] = gradePixel([0.2, 0.5, 0.8], DEFAULT_COLOR);
    expect([r, g, b].map((value) => Number(value.toFixed(5)))).toEqual([0.2, 0.5, 0.8]);
  });

  it("brightens by stops, warms, and desaturates", () => {
    expect(gradePixel([0.25, 0.25, 0.25], { ...DEFAULT_COLOR, exposure: 1 })[0]).toBeCloseTo(0.5);

    const [warmR, , warmB] = balanceGains(1, 0);
    expect(warmR).toBeGreaterThan(1);
    expect(warmB).toBeLessThan(1);

    const [r, g, b] = gradePixel([0.9, 0.2, 0.1], { ...DEFAULT_COLOR, saturation: 0 });
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it("mixes looks by amount", () => {
    expect(lookMatrix("mono", 0).matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const [r, g, b] = gradePixel([0.9, 0.2, 0.1], { ...DEFAULT_COLOR, look: "mono", lookAmount: 1 });
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });
});

import { describe, expect, it } from "vitest";
import { billedCosts, type HiggsfieldRun } from "@/lib/spend/higgsfield-billing";

const SEEDANCE = "bytedance/seedance-2.5/image-to-video";
const KLING = "kling-video/v4.0/image-to-video";

const run = (id: string, createdAt: string, costUsd: number | null, model = SEEDANCE): HiggsfieldRun => ({
  _id: id,
  model,
  createdAt: new Date(createdAt),
  costUsd,
});

const usage = (hour: string, costUsd: number, quantity = 1, model = SEEDANCE) => ({
  hour: new Date(hour),
  model,
  quantity,
  costUsd,
});

describe("Higgsfield billed costs", () => {
  it("takes the billed cost of the one run in its hour", () => {
    // Real runs: estimated $4.5463 and $4.551, billed $3.1843
    const costs = billedCosts(
      [run("a", "2026-10-29T08:59:00Z", 4.5463), run("b", "2026-10-29T09:10:00Z", 4.551)],
      [usage("2026-10-29T08:00:00Z", 3.1843), usage("2026-10-29T09:00:00Z", 3.1843)]
    );
    expect(Object.fromEntries(costs)).toEqual({ a: 3.1843, b: 3.1843 });
  });

  it("splits an hour's cost by the estimates, or evenly without them", () => {
    expect(
      Object.fromEntries(
        billedCosts(
          [run("a", "2026-10-29T09:05:00Z", 1), run("b", "2026-10-29T09:40:00Z", 3)],
          [usage("2026-10-29T09:00:00Z", 2, 2)]
        )
      )
    ).toEqual({ a: 0.5, b: 1.5 });

    expect(
      Object.fromEntries(
        billedCosts(
          [run("a", "2026-10-29T09:05:00Z", null), run("b", "2026-10-29T09:40:00Z", 3)],
          [usage("2026-10-29T09:00:00Z", 2, 2)]
        )
      )
    ).toEqual({ a: 1, b: 1 });
  });

  it("leaves hours that don't match alone", () => {
    const costs = billedCosts(
      [
        // Another run of the model, made outside the app
        run("a", "2026-10-29T09:05:00Z", 1),
        // Not reported yet
        run("b", "2026-10-29T10:05:00Z", 1),
        // Same hour, other model: matched on its own
        run("c", "2026-10-29T09:30:00Z", 1.175, KLING),
      ],
      [usage("2026-10-29T09:00:00Z", 5, 2), usage("2026-10-29T09:00:00Z", 1.175, 1, KLING)]
    );
    expect(Object.fromEntries(costs)).toEqual({ c: 1.175 });
  });
});

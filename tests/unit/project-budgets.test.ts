import { describe, expect, it } from "vitest";
import { budgetRefusal, budgetState, parseAlertPercent, parseBudgetUsd } from "@/lib/project-budgets/shared";

// --------------------------------------------------
// Project budgets: amounts, states, and when a run is
// refused
// --------------------------------------------------

const none = { totalUsd: null, monthlyUsd: null };
const used = (totalSpentUsd: number, monthSpentUsd = totalSpentUsd, inFlightUsd = 0) => ({ totalSpentUsd, monthSpentUsd, inFlightUsd });

describe("amounts", () => {
  it("reads dollars and cents, blank for none", () => {
    expect(["", null, undefined].map(parseBudgetUsd)).toEqual([null, null, null]);
    expect(["250", " $99.5 ", 12.345, "0.01"].map(parseBudgetUsd)).toEqual([250, 99.5, 12.35, 0.01]);
    expect([0, -1, "abc", 0.001, 2_000_000, NaN, {}].map(parseBudgetUsd)).toEqual(Array(7).fill(undefined));
  });
});

describe("states", () => {
  it("warns from 80% and is reached at 100%, counting runs still going", () => {
    expect(budgetState(10, 0, null)).toBe("none");
    expect(budgetState(79, 0, 100)).toBe("ok");
    expect(budgetState(70, 10, 100)).toBe("warning");
    expect(budgetState(90, 10, 100)).toBe("reached");
  });

  it("warns at the project's own alert level", () => {
    expect(budgetState(49, 0, 100, 50)).toBe("ok");
    expect(budgetState(50, 0, 100, 50)).toBe("warning");
    expect(budgetState(85, 0, 100, 90)).toBe("ok");
    expect(budgetState(100, 0, 100, 90)).toBe("reached");
  });

  it("reads an alert level: a whole percent from 1 to 99, blank for 80", () => {
    expect(["", null, undefined].map(parseAlertPercent)).toEqual([80, 80, 80]);
    expect([1, 50, "75", " 90% ", 99].map(parseAlertPercent)).toEqual([1, 50, 75, 90, 99]);
    expect([0, 100, -5, 12.5, "abc", {}, NaN].map(parseAlertPercent)).toEqual(Array(7).fill(undefined));
  });
});

describe("refusing a run", () => {
  it("lets anything through without a budget", () => {
    expect(budgetRefusal("P", none, used(1_000), 50)).toBeNull();
  });

  it("refuses at the budget, and a run that would pass it", () => {
    const budget = { totalUsd: 10, monthlyUsd: null };
    expect(budgetRefusal("P", budget, used(9), 0.5)).toBeNull();
    expect(budgetRefusal("P", budget, used(9), 1)).toBeNull();
    expect(budgetRefusal("P", budget, used(9), 1.01)?.message).toMatch(/would take project "P" over its total budget of \$10\.00 \(\$9\.00 spent, \$1\.00 left\)/);
    expect(budgetRefusal("P", budget, used(10), 0)?.message).toMatch(/has reached its total budget/);
    // Runs still going count
    expect(budgetRefusal("P", budget, used(6, 6, 4), 0)?.message).toMatch(/\$6\.00 spent, \$4\.00 in runs still going/);
  });

  it("checks the monthly budget on this month's spend", () => {
    const budget = { totalUsd: null, monthlyUsd: 5 };
    expect(budgetRefusal("P", budget, used(500, 1), 2)).toBeNull();
    expect(budgetRefusal("P", budget, used(500, 5), 0)).toMatchObject({ kind: "monthly", message: expect.stringMatching(/wait for next month/) });
  });

  it("an unknown price only stops a project that's already at its budget", () => {
    expect(budgetRefusal("P", { totalUsd: 10, monthlyUsd: null }, used(9.99), 0)).toBeNull();
  });
});

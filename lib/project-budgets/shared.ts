// --------------------------------------------------
// PROJECT BUDGETS: types and rules shared by the server
// (lib/project-budgets/server.ts) and the Projects page
//
// A project may have a total budget (everything it has
// ever spent), a monthly one (the calendar month in UTC,
// like API key caps), both, or neither. New runs are
// refused once a budget would be passed; everyone who
// works in the project is told at 80% and at 100%.
// --------------------------------------------------

export const MAX_BUDGET_USD = 1_000_000;

// Where alerts go out
export const WARNING_SHARE = 0.8;

export type ProjectBudget = {
  // null: no budget of that kind
  totalUsd: number | null;
  monthlyUsd: number | null;
};

export type ProjectBudgetUsage = {
  // "2026-11"
  month: string;
  // Billed (the expense ledger)
  totalSpentUsd: number;
  monthSpentUsd: number;
  // Runs still going, at their expected price
  inFlightUsd: number;
  inFlight: number;
};

export type PublicProjectBudget = ProjectBudget & {
  projectId: string;
  usage: ProjectBudgetUsage;
  updatedAt: string | null;
};

export type BudgetKind = "total" | "monthly";
export type BudgetState = "none" | "ok" | "warning" | "reached";

// How one budget is doing. Billed spend plus what's in
// flight: a budget is "reached" once nothing more can
// start without going over.
export function budgetState(spentUsd: number, inFlightUsd: number, budgetUsd: number | null): BudgetState {
  if (budgetUsd === null) return "none";
  const committed = spentUsd + inFlightUsd;
  if (committed >= budgetUsd) return "reached";
  if (committed >= budgetUsd * WARNING_SHARE) return "warning";
  return "ok";
}

// A budget amount from a form or the API: blank or null
// for none, else dollars and cents above zero. undefined
// when it isn't one.
export function parseBudgetUsd(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "string" ? Number(value.trim().replace(/^\$/, "")) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  if (amount <= 0 || amount > MAX_BUDGET_USD) return undefined;
  const cents = Math.round(amount * 100) / 100;
  return cents > 0 ? cents : undefined;
}

export const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Why a run can't start, in the words the person sees.
// null: it may start.
export function budgetRefusal(
  projectName: string,
  budget: ProjectBudget,
  usage: Pick<ProjectBudgetUsage, "totalSpentUsd" | "monthSpentUsd" | "inFlightUsd">,
  runUsd: number
): { kind: BudgetKind; message: string } | null {
  const checks: [BudgetKind, number | null, number][] = [
    ["total", budget.totalUsd, usage.totalSpentUsd],
    ["monthly", budget.monthlyUsd, usage.monthSpentUsd],
  ];

  for (const [kind, limit, spent] of checks) {
    if (limit === null) continue;
    const label = kind === "total" ? "total budget" : "budget for this month";
    const committed = spent + usage.inFlightUsd;
    const used = `${usd(spent)} spent` + (usage.inFlightUsd > 0 ? `, ${usd(usage.inFlightUsd)} in runs still going` : "");
    const after = kind === "total" ? "Ask an admin to raise it." : "Ask an admin to raise it, or wait for next month.";

    if (committed >= limit) {
      return { kind, message: `Project "${projectName}" has reached its ${label} of ${usd(limit)} (${used}). ${after}` };
    }
    if (runUsd > 0 && committed + runUsd > limit) {
      return {
        kind,
        message:
          `This run (about ${usd(runUsd)}) would take project "${projectName}" over its ${label} of ${usd(limit)} ` +
          `(${used}, ${usd(Math.max(0, limit - committed))} left). ${after}`,
      };
    }
  }

  return null;
}

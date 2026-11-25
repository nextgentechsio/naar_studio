"use client";

import { useId, useState } from "react";
import { budgetState, DEFAULT_ALERT_PERCENT, type PublicProjectBudget, usd } from "@/lib/project-budgets/shared";

// --------------------------------------------------
// PROJECT BUDGETS on the Projects page: each project's
// own Budget form (saved on its own, apart from the
// project's details), and how each budget is doing in
// the list. Runs are refused at a budget (the server
// checks); the project's alert level (80% unless the
// budget manager changes it) shows as a warning.
// --------------------------------------------------

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-sunken pl-7 pr-3 text-sm outline-none focus:border-accent";

const amountText = (value: number | null | undefined) => (value == null ? "" : String(value));

export function BudgetForm({
  project,
  budget,
  onSaved,
  onCancel,
}: {
  project: { id: string; name: string };
  budget: PublicProjectBudget | undefined;
  onSaved: (budget: PublicProjectBudget) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [total, setTotal] = useState(amountText(budget?.totalUsd));
  const [monthly, setMonthly] = useState(amountText(budget?.monthlyUsd));
  const [alert, setAlert] = useState(String(budget?.alertPercent ?? DEFAULT_ALERT_PERCENT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/project-budgets/${encodeURIComponent(project.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalUsd: total.trim() || null,
          monthlyUsd: monthly.trim() || null,
          alertPercent: alert.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Save failed (${response.status})`);
      onSaved(data.budget as PublicProjectBudget);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  const field = (label: string, hint: string, value: string, set: (value: string) => void) => {
    const hintId = `${id}-${label.split(" ")[0].toLowerCase()}`;
    return (
      <div className="space-y-2">
        <label className="block space-y-2">
          <span className="block text-sm text-fg">{label}</span>
          <span className="relative block">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-subtle">
              $
            </span>
            <input
              value={value}
              onChange={(event) => set(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="No limit"
              pattern="\d+(\.\d{1,2})?"
              title="An amount in dollars, e.g. 250 or 99.50"
              aria-describedby={hintId}
              className={inputClass}
            />
          </span>
        </label>
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      </div>
    );
  };

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className="font-semibold">Budget for {project.name}</h2>
        <p className="mt-1 text-xs text-fg-subtle">
          New runs are refused once a budget would be passed. Admins and everyone working in the project are notified at the
          alert level you choose, and again at 100%. Leave a budget empty for no limit.
        </p>
      </div>

      {budget && (
        <p className="text-sm text-fg-muted">
          Spent so far: {usd(budget.usage.totalSpentUsd)} in total, {usd(budget.usage.monthSpentUsd)} this month
          {budget.usage.inFlightUsd > 0 && ` (+ ${usd(budget.usage.inFlightUsd)} in runs still going)`}.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("Total budget", "Everything the project spends, ever.", total, setTotal)}
        {field("Monthly budget", "Resets on the 1st of each month (UTC).", monthly, setMonthly)}
      </div>

      <div className="space-y-2">
        <label className="block space-y-2">
          <span className="block text-sm text-fg">Alert at</span>
          <span className="relative block max-w-[10rem]">
            <input
              value={alert}
              onChange={(event) => setAlert(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={String(DEFAULT_ALERT_PERCENT)}
              pattern="[1-9][0-9]?"
              title="A whole percent from 1 to 99"
              aria-describedby={`${id}-alert`}
              className="h-11 w-full rounded-xl border border-line bg-sunken pl-3 pr-8 text-sm outline-none focus:border-accent"
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-subtle">
              %
            </span>
          </span>
        </label>
        <p id={`${id}-alert`} className="text-xs text-fg-subtle">
          The early warning, as a share of each budget (1–99%). Everyone is told again when a budget is reached.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Common alert levels">
          {[50, 75, 80, 90].map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={alert.trim() === String(level)}
              onClick={() => setAlert(String(level))}
              className={`rounded-lg border px-2.5 py-1 text-xs hover:bg-raised ${
                alert.trim() === String(level) ? "border-accent text-accent" : "border-line-strong text-fg-muted"
              }`}
            >
              {level}%
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:bg-raised disabled:text-fg-subtle"
        >
          {saving ? "Saving..." : "Save budget"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BudgetUsage({ budget }: { budget: PublicProjectBudget | undefined }) {
  if (!budget || (budget.totalUsd === null && budget.monthlyUsd === null)) {
    return budget && budget.usage.totalSpentUsd > 0 ? (
      <p className="mt-1 text-xs text-fg-subtle">{usd(budget.usage.totalSpentUsd)} spent · no budget</p>
    ) : null;
  }

  const { usage } = budget;
  const rows: { label: string; spent: number; limit: number }[] = [];
  if (budget.totalUsd !== null) rows.push({ label: "Total", spent: usage.totalSpentUsd, limit: budget.totalUsd });
  if (budget.monthlyUsd !== null) rows.push({ label: "This month", spent: usage.monthSpentUsd, limit: budget.monthlyUsd });

  return (
    <div className="mt-2 max-w-sm space-y-1.5">
      {rows.map((row) => {
        const state = budgetState(row.spent, usage.inFlightUsd, row.limit, budget.alertPercent);
        const share = Math.min(1, row.spent / row.limit);
        const tone = state === "reached" ? "bg-danger" : state === "warning" ? "bg-warning" : "bg-accent";
        const text = state === "reached" ? "text-danger" : state === "warning" ? "text-warning" : "text-fg-subtle";
        return (
          <div key={row.label}>
            <div className={`flex justify-between gap-3 text-xs ${text}`}>
              <span>
                {row.label}: {usd(row.spent)} of {usd(row.limit)}
              </span>
              <span>{state === "reached" ? "Reached" : `${Math.floor(share * 100)}%`}</span>
            </div>
            <div
              className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-raised"
              role="progressbar"
              aria-label={`${row.label} budget used`}
              aria-valuenow={Math.floor(share * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${share * 100}%` }} />
              {/* Where the alert goes out */}
              <div
                aria-hidden="true"
                className="absolute inset-y-0 w-0.5 bg-fg-subtle/70"
                style={{ left: `${budget.alertPercent ?? DEFAULT_ALERT_PERCENT}%` }}
              />
            </div>
          </div>
        );
      })}
      {usage.inFlightUsd > 0 && <p className="text-xs text-fg-subtle">+ {usd(usage.inFlightUsd)} in runs still going</p>}
      <p className="text-xs text-fg-subtle">Alert at {budget.alertPercent ?? DEFAULT_ALERT_PERCENT}%</p>
    </div>
  );
}

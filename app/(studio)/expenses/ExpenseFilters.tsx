"use client";

import { Button, cx, inputClass } from "@/app/components/ui/primitives";
import { localPeriods, type ExpenseQuery } from "@/lib/client/data";
import type { ExpenseReport } from "@/lib/expenses";
import { modelLabel } from "@/lib/model-catalog";

// --------------------------------------------------
// EXPENSES FILTER BAR
//
// Controlled by the URL (see ExpensesView), so a
// filtered view can be refreshed, shared and navigated
// with Back, like History.
// --------------------------------------------------

export type ExpenseRange = "" | "today" | "week" | "month" | "30d" | "custom";

export type ExpenseFilterValues = {
  project: string;
  user: string;
  model: string;
  range: ExpenseRange;
  // YYYY-MM-DD, local days, both included; custom range
  from: string;
  to: string;
};

export const RANGES: [ExpenseRange, string][] = [
  ["", "All time"],
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["30d", "Last 30 days"],
  ["custom", "Custom"],
];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Local midnight at the start of a YYYY-MM-DD day
function dayStart(day: string, addDays = 0): Date | null {
  if (!DAY_PATTERN.test(day)) return null;

  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year, month - 1, date + addDays);

  return Number.isNaN(start.getTime()) ? null : start;
}

// The filters as the API takes them: the range becomes
// local-midnight instants, `to` exclusive
export function toExpenseQuery(values: ExpenseFilterValues): ExpenseQuery {
  const { todayStart, weekStart, monthStart } = localPeriods();
  let from: Date | null = null;
  let to: Date | null = null;

  if (values.range === "today") from = todayStart;
  if (values.range === "week") from = weekStart;
  if (values.range === "month") from = monthStart;
  if (values.range === "30d") {
    from = new Date(todayStart);
    from.setDate(todayStart.getDate() - 29);
  }
  if (values.range === "custom") {
    from = dayStart(values.from);
    // Through the end of the last day
    to = dayStart(values.to, 1);
  }

  return {
    project: values.project || undefined,
    user: values.user || undefined,
    model: values.model || undefined,
    from: from?.toISOString(),
    to: to?.toISOString(),
  };
}

const selectClass = cx(inputClass, "w-full sm:w-auto sm:min-w-40");

export default function ExpenseFilters({
  values,
  options,
  showUser,
  onChange,
  onClear,
}: {
  values: ExpenseFilterValues;
  options: ExpenseReport["options"] | undefined;
  showUser: boolean;
  onChange: (patch: Partial<ExpenseFilterValues>) => void;
  onClear: () => void;
}) {
  const active =
    values.project || values.user || values.model || values.range;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <select
          aria-label="Project"
          value={values.project}
          onChange={(event) => onChange({ project: event.target.value })}
          className={selectClass}
        >
          <option value="">All projects</option>
          {options?.projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Model"
          value={values.model}
          onChange={(event) => onChange({ model: event.target.value })}
          className={selectClass}
        >
          <option value="">All models</option>
          {options?.models.map((id) => (
            <option key={id} value={id}>
              {modelLabel(id)}
            </option>
          ))}
        </select>

        {showUser && (
          <select
            aria-label="User"
            value={values.user}
            onChange={(event) => onChange({ user: event.target.value })}
            className={selectClass}
          >
            <option value="">Everyone</option>
            {options?.users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* min-h keeps the bar from growing when "Clear
          filters" appears */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Date range"
            className="flex flex-wrap gap-1.5"
          >
            {RANGES.map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={values.range === value}
                onClick={() => onChange({ range: value })}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  values.range === value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {values.range === "custom" && (
            <div className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="date"
                aria-label="From"
                value={values.from}
                max={values.to || undefined}
                onChange={(event) => onChange({ from: event.target.value })}
                className={cx(inputClass, "h-8 w-auto px-2 text-xs")}
              />
              <span aria-hidden="true">–</span>
              <input
                type="date"
                aria-label="To"
                value={values.to}
                min={values.from || undefined}
                onChange={(event) => onChange({ to: event.target.value })}
                className={cx(inputClass, "h-8 w-auto px-2 text-xs")}
              />
            </div>
          )}
        </div>

        {active && (
          <Button size="sm" variant="ghost" icon="close" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

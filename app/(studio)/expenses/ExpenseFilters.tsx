"use client";

import { Button, cx, inputClass } from "@/app/components/ui/primitives";
import { PLATFORMS, type ExpenseQuery, type Platform } from "@/lib/client/data";
import { DATE_RANGES, rangeInstants, type DateRange } from "@/lib/client/date-range";
import type { ExpenseReport } from "@/lib/spend/expenses";
import { modelLabel } from "@/lib/replicate/catalog";

// --------------------------------------------------
// EXPENSES FILTER BAR
//
// Controlled by the URL (see ExpensesView), so a
// filtered view can be refreshed, shared and navigated
// with Back, like History.
// --------------------------------------------------

export type ExpenseRange = DateRange;

export type ExpenseFilterValues = {
  project: string;
  user: string;
  model: string;
  // Replicate or Higgsfield ("" for both)
  platform: Platform;
  range: ExpenseRange;
  // YYYY-MM-DD, local days, both included; custom range
  from: string;
  to: string;
};

export const RANGES = DATE_RANGES;

// The filters as the API takes them: the range becomes
// local-midnight instants, `to` exclusive
export function toExpenseQuery(values: ExpenseFilterValues): ExpenseQuery {
  return {
    project: values.project || undefined,
    user: values.user || undefined,
    model: values.model || undefined,
    provider: values.platform || undefined,
    ...rangeInstants(values.range, values.from, values.to),
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
    values.project || values.user || values.model || values.platform || values.range;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <select
          aria-label="Platform"
          value={values.platform}
          onChange={(event) => onChange({ platform: event.target.value as Platform })}
          className={selectClass}
        >
          {PLATFORMS.map(([value, label]) => (
            <option key={value || "all"} value={value}>
              {label}
            </option>
          ))}
        </select>

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

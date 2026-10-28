"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { Button, cx, inputClass } from "@/app/components/ui/primitives";
import type { HistoryPage, HistoryStatus } from "@/lib/client/data";
import { DATE_RANGES, type DateRange } from "@/lib/client/date-range";
import { modelLabel } from "@/lib/replicate/catalog";

// --------------------------------------------------
// HISTORY FILTER BAR
//
// Controlled by the URL (see HistoryView), so filtered
// views can be refreshed, shared and navigated with Back.
// --------------------------------------------------

export type FilterValues = {
  q: string;
  project: string;
  model: string;
  user: string;
  status: "" | HistoryStatus;
  // When it was created (see lib/client/date-range.ts);
  // from/to: YYYY-MM-DD local days, for "custom"
  range: DateRange;
  from: string;
  to: string;
};

// How each range reads in the Created menu
const CREATED_LABELS: Record<DateRange, string> = {
  "": "Created any time",
  today: "Created today",
  week: "Created this week",
  month: "Created this month",
  "30d": "Created in the last 30 days",
  custom: "Created between…",
};

const STATUS_OPTIONS: ["" | HistoryStatus, string][] = [
  ["", "All"],
  ["succeeded", "Succeeded"],
  ["failed", "Failed"],
  ["running", "Running"],
  // The super admin only (showHidden)
  ["hidden", "Hidden"],
];

const selectClass = cx(inputClass, "w-full sm:w-auto sm:min-w-40");

export default function HistoryFilters({
  values,
  options,
  showUser,
  showHidden,
  onChange,
  onClear,
}: {
  values: FilterValues;
  options: HistoryPage["options"] | undefined;
  showUser: boolean;
  // The "Hidden" chip (the super admin)
  showHidden: boolean;
  onChange: (patch: Partial<FilterValues>) => void;
  onClear: () => void;
}) {
  // Typing updates the URL after a short pause, not on
  // every keystroke. The input follows the URL only when
  // it changes from elsewhere (Clear, Back): the echo of
  // our own update must not wipe what was typed since.
  const [draft, setDraft] = useState(values.q);
  const [syncedQ, setSyncedQ] = useState(values.q);
  const [pushedQ, setPushedQ] = useState(values.q);

  if (values.q !== syncedQ) {
    setSyncedQ(values.q);

    if (values.q !== pushedQ) {
      setPushedQ(values.q);
      setDraft(values.q);
    }
  }

  useEffect(() => {
    const q = draft.trim();
    if (q === values.q) return;

    const timer = setTimeout(() => {
      setPushedQ(q);
      onChange({ q });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, values.q, onChange]);

  const active =
    values.q || values.project || values.model || values.user || values.status || values.range;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-64">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search prompts"
            aria-label="Search prompts"
            maxLength={100}
            className={cx(inputClass, "pl-9")}
          />
        </div>

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
            aria-label="Created by"
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

        <select
          aria-label="Created"
          value={values.range}
          onChange={(event) => {
            const range = event.target.value as DateRange;
            // Custom dates only mean something for "custom"
            onChange(range === "custom" ? { range } : { range, from: "", to: "" });
          }}
          className={selectClass}
        >
          {DATE_RANGES.map(([value]) => (
            <option key={value || "any"} value={value}>
              {CREATED_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {/* min-h keeps the bar from growing when "Clear
          filters" appears */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap gap-1.5"
          >
            {STATUS_OPTIONS.filter(([value]) => value !== "hidden" || showHidden).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={values.status === value}
                onClick={() => onChange({ status: value })}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  values.status === value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {values.range === "custom" && (
            <div className="ui-rise flex items-center gap-1.5 text-xs text-fg-muted">
              <span>Created</span>
              <input
                type="date"
                aria-label="Created from"
                value={values.from}
                max={values.to || undefined}
                onChange={(event) => onChange({ from: event.target.value })}
                className={cx(inputClass, "h-8 w-auto px-2 text-xs")}
              />
              <span aria-hidden="true">–</span>
              <input
                type="date"
                aria-label="Created to"
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

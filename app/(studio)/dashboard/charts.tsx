"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cx, formatCost } from "@/app/components/ui/primitives";

// --------------------------------------------------
// DASHBOARD CHARTS
//
// Built to the dataviz rules: thin marks (columns at most
// 24px, 4px rounded data end, square at the baseline),
// a 2px surface gap between stacked segments, hairline
// solid gridlines, clean rounded ticks, a legend for two
// or more series, a tooltip on hover and on keyboard
// focus, and a table view for every chart. Colors are
// the validated --viz-* slots; text stays in text tokens.
// --------------------------------------------------

export type Series<K extends string> = {
  key: K;
  label: string;
  // A CSS color, e.g. "var(--viz-1)"
  color: string;
};

// Round the axis top to 1, 2, 2.5 or 5 × 10^n, in 4 steps
function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };

  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((value) => value >= rough) ?? 10 * power;

  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => +(step * i).toPrecision(12)) };
}

// Axis money: "$0", "$0.25", "$12", "$1.2K"
function axisUsd(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1000) return `$${+(value / 1000).toFixed(1)}K`;
  if (value >= 10) return `$${Math.round(value)}`;
  return `$${+value.toFixed(2)}`;
}

function Legend<K extends string>({ series }: { series: Series<K>[] }) {
  if (series.length < 2) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// A chart card's "Chart / Table" switch
export function ViewSwitch({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <div role="group" aria-label="View" className="flex rounded-lg border border-line p-0.5 text-xs">
      {(["Chart", "Table"] as const).map((label) => {
        const active = (label === "Table") === table;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(label === "Table")}
            className={cx(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              active ? "bg-raised text-fg" : "text-fg-subtle hover:text-fg",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------
// SPEND PER DAY: stacked columns, one per day
// --------------------------------------------------

export type DayValues<K extends string> = { day: string; runs: number } & Record<K, number>;

const PLOT_HEIGHT = 200;

function dayLabel(day: string, style: "short" | "long") {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(
    undefined,
    style === "short" ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short" },
  );
}

export function SpendColumns<K extends string>({
  days,
  series,
  table,
}: {
  days: DayValues<K>[];
  series: Series<K>[];
  table: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  const totals = days.map((day) => series.reduce((sum, item) => sum + (day[item.key] || 0), 0));
  const { top, ticks } = niceScale(Math.max(0, ...totals));
  // About 7 date labels whatever the period
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));

  if (table) {
    return (
      <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-left text-xs text-fg-subtle backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-medium">Day</th>
              {series.map((item) => (
                <th key={item.key} className="px-3 py-2 text-right font-medium">{item.label}</th>
              ))}
              {series.length > 1 && <th className="px-3 py-2 text-right font-medium">Total</th>}
              <th className="px-3 py-2 text-right font-medium">Runs</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {days.map((day, index) => (
              <tr key={day.day} className="border-t border-line">
                <td className="px-3 py-1.5 text-fg-muted">{dayLabel(day.day, "long")}</td>
                {series.map((item) => (
                  <td key={item.key} className="px-3 py-1.5 text-right">{formatCost(day[item.key])}</td>
                ))}
                {series.length > 1 && <td className="px-3 py-1.5 text-right font-medium">{formatCost(totals[index])}</td>}
                <td className="px-3 py-1.5 text-right text-fg-muted">{day.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!days.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((index) => Math.min(days.length - 1, Math.max(0, (index ?? (step > 0 ? -1 : days.length)) + step)));
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  const activeDay = active === null ? null : days[active];

  return (
    <div className="space-y-3">
      <Legend series={series} />

      <div className="flex gap-2">
        {/* Y axis: clean rounded ticks */}
        <div className="relative w-11 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (tick / top) * 100}%` }}>
              {axisUsd(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            role="img"
            tabIndex={0}
            aria-label={`Spend per day, ${days.length} days. Use the arrow keys to read each day; the table view lists them all.`}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="relative rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            style={{ height: PLOT_HEIGHT }}
          >
            {/* Hairline solid gridlines; the 0 line is the baseline */}
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden
                className={cx("absolute inset-x-0 h-px", tick === 0 ? "bg-line-strong" : "bg-line")}
                style={{ top: `${100 - (tick / top) * 100}%` }}
              />
            ))}

            <div className="absolute inset-0 flex items-end">
              {days.map((day, index) => {
                const visible = series.filter((item) => day[item.key] > 0);
                return (
                  <div
                    key={day.day}
                    // The whole day's band is the hit target
                    className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
                    onPointerEnter={() => setActive(index)}
                  >
                    <div
                      className={cx(
                        "flex w-[70%] max-w-6 flex-col-reverse gap-[2px] transition-opacity",
                        active !== null && active !== index && "opacity-50",
                      )}
                    >
                      {visible.map((item, position) => (
                        <div
                          key={item.key}
                          className={cx(position === visible.length - 1 && "rounded-t-[4px]")}
                          style={{
                            background: item.color,
                            // Tiny but real spend still shows
                            height: Math.max(2, (day[item.key] / top) * PLOT_HEIGHT - (position > 0 ? 2 : 0)),
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {activeDay && active !== null && (
              <div
                role="status"
                className="glass-menu pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-xl"
                style={{
                  left: `${Math.min(88, Math.max(12, ((active + 0.5) / days.length) * 100))}%`,
                  top: 4,
                }}
              >
                <p className="text-fg-subtle">{dayLabel(activeDay.day, "long")}</p>
                <p className="mt-0.5 text-sm font-semibold text-fg">{formatCost(totals[active])}</p>
                {series.length > 1 &&
                  series.map((item) => (
                    <p key={item.key} className="mt-1 flex items-center justify-between gap-3 text-fg-muted">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: item.color }} />
                        {item.label}
                      </span>
                      <span className="tabular-nums text-fg">{formatCost(activeDay[item.key])}</span>
                    </p>
                  ))}
                <p className="mt-1 text-fg-subtle">
                  {activeDay.runs} billed run{activeDay.runs === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>

          {/* X axis: a few dates, never one per column */}
          <div className="relative mt-2 h-4 text-[11px] text-fg-subtle">
            {days.map((day, index) =>
              index % labelEvery === 0 ? (
                <span
                  key={day.day}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((index + 0.5) / days.length) * 100}%` }}
                >
                  {dayLabel(day.day, "short")}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------
// RANKED BARS: one row per item, value at the bar's tip
// --------------------------------------------------

export type BarRow = {
  key: string;
  label: ReactNode;
  // Under the label, e.g. "12 runs · $0.04 per run"
  detail?: ReactNode;
  value: number;
  color: string;
};

// Two lines a row: label, detail and value, then the bar
// (the detail drops under the bar on phones). Every row
// is listed. columns: two columns on wide screens, for
// full-width cards (ranked top to bottom, then across).
//
// Height: the list fills whatever room its card has (a
// card stretched by a taller neighbour shows more rows),
// but asks for at most LIST_CAP_REM itself, so a long
// list can't make the whole row grow. It scrolls, and
// says so, only when rows are actually out of sight.
export function BarList({
  rows,
  empty,
  noun,
  columns = false,
}: {
  rows: BarRow[];
  empty: string;
  // For the count, e.g. "models"
  noun?: string;
  columns?: boolean;
}) {
  if (!rows.length) {
    return <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">{empty}</p>;
  }

  return <Bars rows={rows} noun={noun} columns={columns} />;
}

function Bars({ rows, noun, columns }: { rows: BarRow[]; noun?: string; columns: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The rows' full height and the cap (px), once
  // measured, and whether some rows are out of sight
  const [size, setSize] = useState<{ content: number; cap: number; hidden: boolean } | null>(null);

  useLayoutEffect(() => {
    const box = scroller.current;
    const items = list.current;
    if (!box || !items) return;

    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setSize({
        content: items.offsetHeight,
        cap: LIST_CAP_REM * rem,
        hidden: box.scrollHeight > box.clientHeight + 1,
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(items);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(...rows.map((row) => row.value), 0);
  const scrolls = size?.hidden ?? false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Asks for the rows' height up to the cap; grows
          with a taller card */}
      <div
        className="relative min-h-0 flex-1"
        style={size ? { minHeight: Math.min(size.content, size.cap) } : undefined}
      >
        <div
          ref={scroller}
          tabIndex={scrolls ? 0 : undefined}
          role={scrolls ? "region" : undefined}
          aria-label={scrolls && noun ? `All ${rows.length} ${noun}` : undefined}
          className={cx(
            "overflow-y-auto pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            // Before measuring: the plain cap
            size ? "absolute inset-y-0 -right-2 left-0" : "-mr-2 max-h-[22rem]"
          )}
        >
          <ul
            ref={list}
            className={cx("grid gap-y-3", columns && "lg:grid-flow-col lg:grid-rows-[repeat(var(--rows),auto)] lg:gap-x-10")}
            // Column by column: first half left, rest right
            style={columns ? ({ "--rows": Math.ceil(rows.length / 2) } as CSSProperties) : undefined}
          >
            {rows.map((row) => (
              <li key={row.key} className="min-w-0">
                <div className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-fg">{row.label}</span>
                  {row.detail && <span className="hidden shrink-0 text-xs text-fg-subtle sm:inline">{row.detail}</span>}
                  <span className="w-16 shrink-0 text-right tabular-nums font-medium text-fg">{formatCost(row.value)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-r-[4px] bg-raised">
                  <div
                    className="h-full rounded-r-[4px]"
                    style={{ width: `${max > 0 ? Math.max(1.5, (row.value / max) * 100) : 0}%`, background: row.color }}
                  />
                </div>
                {/* Phones: no room beside the label */}
                {row.detail && <p className="mt-1 text-xs text-fg-subtle sm:hidden">{row.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {scrolls && noun && (
        <p className="mt-3 text-xs text-fg-subtle">
          {rows.length} {noun} · scroll for more
        </p>
      )}
    </div>
  );
}

// Most a list asks for itself (22rem: about 8 rows)
const LIST_CAP_REM = 22;

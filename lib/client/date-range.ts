import { localPeriods } from "@/lib/client/data";

// --------------------------------------------------
// DATE RANGE FILTERS (browser only)
//
// Shared by Expenses and History: a preset ("today",
// "last 30 days"…) or a custom pair of local days,
// turned into the instants the APIs take. Days are the
// viewer's, so "today" starts at their midnight.
// --------------------------------------------------

export type DateRange = "" | "today" | "week" | "month" | "30d" | "custom";

export const DATE_RANGES: [DateRange, string][] = [
  ["", "All time"],
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["30d", "Last 30 days"],
  ["custom", "Custom"],
];

export function isDateRange(value: unknown): value is DateRange {
  return DATE_RANGES.some(([range]) => range === value);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Local midnight at the start of a YYYY-MM-DD day
function dayStart(day: string, addDays = 0): Date | null {
  if (!DAY_PATTERN.test(day)) return null;

  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year, month - 1, date + addDays);

  return Number.isNaN(start.getTime()) ? null : start;
}

// The range as ISO instants; `to` is exclusive (the
// custom range runs through the end of its last day)
export function rangeInstants(
  range: DateRange,
  fromDay: string,
  toDay: string
): { from?: string; to?: string } {
  const { todayStart, weekStart, monthStart } = localPeriods();
  let from: Date | null = null;
  let to: Date | null = null;

  if (range === "today") from = todayStart;
  if (range === "week") from = weekStart;
  if (range === "month") from = monthStart;
  if (range === "30d") {
    from = new Date(todayStart);
    from.setDate(todayStart.getDate() - 29);
  }
  if (range === "custom") {
    from = dayStart(fromDay);
    to = dayStart(toDay, 1);
  }

  return { from: from?.toISOString(), to: to?.toISOString() };
}

// --------------------------------------------------
// DASHBOARD PERIODS
// --------------------------------------------------

export type DashboardRange = "7d" | "30d" | "90d" | "month";

export const DASHBOARD_RANGES: [DashboardRange, string][] = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["month", "This month"],
];

export function readDashboardRange(value: string | null): DashboardRange {
  return DASHBOARD_RANGES.some(([range]) => range === value) ? (value as DashboardRange) : "30d";
}

// YYYY-MM-DD of a local date
function localDay(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// The period as local midnights (to: tomorrow, exclusive),
// and every day in it, oldest first
export function dashboardPeriod(range: DashboardRange, now = new Date()) {
  const { todayStart, monthStart } = localPeriods(now);
  const to = new Date(todayStart);
  to.setDate(todayStart.getDate() + 1);

  let from: Date;
  if (range === "month") {
    from = monthStart;
  } else {
    from = new Date(todayStart);
    from.setDate(todayStart.getDate() - (Number.parseInt(range, 10) - 1));
  }

  const days: string[] = [];
  for (const day = new Date(from); day < to; day.setDate(day.getDate() + 1)) {
    days.push(localDay(day));
  }

  return { from, to, monthStart, days };
}

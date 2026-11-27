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

export type DashboardRange = "7d" | "30d" | "90d" | "month" | "custom";

export const DASHBOARD_RANGES: [DashboardRange, string][] = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["month", "This month"],
  ["custom", "Custom"],
];

// The longest custom period (the analytics API's limit)
export const MAX_CUSTOM_DAYS = 400;

// Days a custom period covers, first and last included
export function daysBetween(fromDay: string, toDay: string): number | null {
  const from = dayStart(fromDay);
  const to = dayStart(toDay);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

// Why a custom period can't be used, or null when it can
export function customRangeError(fromDay: string, toDay: string, now = new Date()): string | null {
  if (!dayStart(fromDay) || !dayStart(toDay)) return "Choose a start and an end date";
  const span = daysBetween(fromDay, toDay)!;
  if (span < 1) return "The end date must be on or after the start date";
  if (span > MAX_CUSTOM_DAYS) return `Choose a period of up to ${MAX_CUSTOM_DAYS} days`;
  if (fromDay > localDay(now)) return "The start date can't be in the future";
  return null;
}

// "Oct 1 – Oct 15, 2026" (the year once, when shared)
export function customRangeLabel(fromDay: string, toDay: string): string {
  const from = dayStart(fromDay);
  const to = dayStart(toDay);
  if (!from || !to) return "Custom";
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  if (fromDay === toDay) return day(from, true);
  return `${day(from, from.getFullYear() !== to.getFullYear())} – ${day(to, true)}`;
}

export const todayLocalDay = (now = new Date()) => localDay(now);

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
// (custom: its own days, through the end of the last one)
export function dashboardPeriod(
  range: DashboardRange,
  now = new Date(),
  custom?: { from: string; to: string } | null
) {
  const { todayStart, monthStart } = localPeriods(now);
  let to = new Date(todayStart);
  to.setDate(todayStart.getDate() + 1);

  let from: Date;
  const customFrom = range === "custom" && custom ? dayStart(custom.from) : null;
  const customTo = range === "custom" && custom ? dayStart(custom.to, 1) : null;
  if (customFrom && customTo) {
    from = customFrom;
    to = customTo;
  } else if (range === "month") {
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

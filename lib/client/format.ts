// --------------------------------------------------
// DISPLAY FORMATTING (browser only)
// --------------------------------------------------

const SAME_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const OTHER_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// "8 Oct, 12:25 pm" (year only when it isn't this year);
// month names avoid the 10/8 vs 8/10 ambiguity
export function formatDateTime(value: string | Date): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return (
    date.getFullYear() === new Date().getFullYear()
      ? SAME_YEAR
      : OTHER_YEAR
  ).format(date);
}

export function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";

  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

// How long a run took: the provider's own run time when
// it reports one, else start to finish (which includes any
// queue time); null while running or when unknown
export function generationSeconds(run: {
  predictTime: number | null;
  createdAt: string;
  completedAt: string | null;
}): number | null {
  if (typeof run.predictTime === "number" && Number.isFinite(run.predictTime) && run.predictTime > 0) {
    return run.predictTime;
  }
  if (!run.completedAt) return null;
  const ms = Date.parse(run.completedAt) - Date.parse(run.createdAt);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

// Compact for cards: "4.2s", "38s", "2m 05s", "1h 03m"
export function formatShortDuration(seconds: number): string {
  if (seconds < 10) return `${Math.max(0, seconds).toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const total = Math.round(seconds);
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
}

import { describe, expect, it } from "vitest";
import { customRangeError, customRangeLabel, dashboardPeriod, daysBetween } from "@/lib/client/date-range";

// --------------------------------------------------
// The Dashboard's custom period: which pairs of days are
// usable, and the days and instants they cover
// --------------------------------------------------

const now = new Date(2026, 10, 27, 15, 0); // 27 Nov 2026, local

describe("custom period", () => {
  it("covers its first and last day", () => {
    expect(daysBetween("2026-11-01", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);

    const period = dashboardPeriod("custom", now, { from: "2026-10-30", to: "2026-11-02" });
    expect(period.days).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(period.from).toEqual(new Date(2026, 9, 30));
    // Exclusive: midnight after the last day
    expect(period.to).toEqual(new Date(2026, 10, 3));
  });

  it("refuses periods that can't be shown", () => {
    expect(customRangeError("2026-11-01", "2026-11-20", now)).toBeNull();
    expect(customRangeError("", "2026-11-20", now)).toMatch(/Choose a start and an end/);
    expect(customRangeError("2026-11-20", "2026-11-01", now)).toMatch(/on or after/);
    expect(customRangeError("2025-01-01", "2026-11-20", now)).toMatch(/up to 400 days/);
    expect(customRangeError("2026-12-01", "2026-12-05", now)).toMatch(/future/);
    expect(customRangeError("2026-13-45", "2026-11-20", now)).not.toBeNull();
  });

  it("falls back to the preset when the custom days are missing", () => {
    expect(dashboardPeriod("30d", now).days).toHaveLength(30);
  });

  it("reads as dates, with the year once when shared", () => {
    expect(customRangeLabel("2026-10-01", "2026-10-15")).toMatch(/Oct 1 – Oct 15, 2026/);
    expect(customRangeLabel("2025-12-20", "2026-01-05")).toMatch(/Dec 20, 2025 – Jan 5, 2026/);
    expect(customRangeLabel("2026-11-03", "2026-11-03")).toMatch(/Nov 3, 2026/);
  });
});

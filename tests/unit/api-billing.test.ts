import { describe, expect, it } from "vitest";
import { parsePeriod, statementCsv, type ApiCharge } from "@/lib/api-keys/billing";

// --------------------------------------------------
// Billing API: periods, and a statement that is safe to
// open in a spreadsheet
// --------------------------------------------------

const params = (query: string) => new URLSearchParams(query);
const now = new Date("2026-11-23T10:00:00Z");

describe("periods", () => {
  it("defaults to this month in UTC", () => {
    expect(parsePeriod(params(""), now)).toEqual({
      period: { label: "2026-11", from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") },
    });
  });

  it("takes a date range with both days included", () => {
    expect(parsePeriod(params("from=2026-11-01&to=2026-11-15"), now)).toEqual({
      period: { label: "2026-11-01..2026-11-15", from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-16T00:00:00Z") },
    });
  });

  it("refuses bad periods", () => {
    for (const query of ["month=2026-1", "from=2026-11-01", "to=2026-11-01", "from=2026-11-31&to=2026-12-01", "from=2026-11-02&to=2026-11-01", "from=2025-01-01&to=2026-06-01", "month=2026-11&to=2026-11-02"]) {
      expect(parsePeriod(params(query), now), query).toHaveProperty("error");
    }
  });
});

describe("the CSV statement", () => {
  const charge = (fields: Partial<ApiCharge>): ApiCharge => ({
    id: "c1",
    object: "charge",
    generationId: "g1",
    platform: "replicate",
    model: "google/nano-banana",
    project: { id: "p1", name: "Spring" },
    amountUsd: 0.039,
    currency: "USD",
    priced: true,
    pricingSource: "estimated",
    incurredAt: "2026-11-02T09:00:00.000Z",
    ...fields,
  });

  it("writes one row per charge, quoting commas and quotes", () => {
    const csv = statementCsv([charge({ project: { id: "p1", name: 'Acme, "spring"' } }), charge({ id: "c2", amountUsd: null, priced: false })]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe('2026-11-02T09:00:00.000Z,c1,g1,replicate,google/nano-banana,p1,"Acme, ""spring""",0.039000,yes,estimated');
    expect(lines[2]).toBe("2026-11-02T09:00:00.000Z,c2,g1,replicate,google/nano-banana,p1,Spring,,no,estimated");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("stops a name from running as a spreadsheet formula", () => {
    for (const name of ["=HYPERLINK(\"x\")", "+1", "-1", "@SUM(A1)"]) {
      const row = statementCsv([charge({ project: { id: "p1", name } })]).split("\r\n")[1];
      expect(row).toContain(`'${name.replace(/"/g, '""')}`);
    }
  });
});

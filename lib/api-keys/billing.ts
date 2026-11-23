import type { ExpenseDoc } from "@/lib/db/mongodb";
import { expensesCollection } from "@/lib/db/mongodb";
import type { ApiKeyDoc } from "./db";
import { capState, isMonthKey, monthKey, monthRange } from "./shared";
import { keySpend } from "./spend";

// --------------------------------------------------
// BILLING FOR ONE KEY (/api/v1/billing/*)
//
// Read only, and only ever the calling key's own charges:
// one charge per succeeded run, from the expense ledger,
// at the platform's price (no markup). A run whose model
// has no known price is listed with amountUsd null and
// counted in "unpricedRuns", never silently as $0.
// Periods are UTC: a calendar month, or from/to dates.
// --------------------------------------------------

export const BILLING_PAGE_SIZE = 50;
export const BILLING_MAX_PAGE_SIZE = 200;
// A statement lists at most this many charges
export const STATEMENT_MAX_ROWS = 50_000;
// The longest from/to period
const MAX_PERIOD_DAYS = 366;

export type BillingPeriod = { label: string; from: Date; to: Date };

const DAY_MS = 86_400_000;

function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

// ?month=2026-11, or ?from=2026-11-01&to=2026-11-15 (both
// days included), or nothing: this month
export function parsePeriod(params: URLSearchParams, now = new Date()): { period: BillingPeriod } | { error: string } {
  const month = params.get("month");
  const fromText = params.get("from");
  const toText = params.get("to");

  if (month && (fromText || toText)) return { error: "Use month, or from and to, not both." };
  if (fromText || toText) {
    if (!fromText || !toText) return { error: "from and to go together, as dates like 2026-11-01." };
    const from = parseDay(fromText);
    const toDay = parseDay(toText);
    if (!from || !toDay) return { error: "from and to must be dates like 2026-11-01." };
    if (toDay < from) return { error: "to must be on or after from." };
    const to = new Date(toDay.getTime() + DAY_MS);
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_PERIOD_DAYS) {
      return { error: `A period can be at most ${MAX_PERIOD_DAYS} days.` };
    }
    return { period: { label: `${fromText}..${toText}`, from, to } };
  }
  if (month && !isMonthKey(month)) return { error: "month must look like 2026-11." };
  const key = month ?? monthKey(now);
  return { period: { label: key, ...monthRange(key) } };
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

// --------------------------------------------------
// ONE CHARGE, AS THE API SHOWS IT
// --------------------------------------------------

export type ApiCharge = {
  id: string;
  object: "charge";
  generationId: string;
  platform: string;
  model: string;
  project: { id: string; name: string };
  amountUsd: number | null;
  currency: "USD";
  priced: boolean;
  // "estimated": our price table or the platform's quote;
  // "billed": what the platform reported it charged
  pricingSource: ExpenseDoc["pricingSource"];
  incurredAt: string;
};

export function toApiCharge(doc: ExpenseDoc): ApiCharge {
  const priced = typeof doc.amountUsd === "number";
  return {
    id: doc._id,
    object: "charge",
    generationId: doc.generationId,
    platform: doc.provider ?? "replicate",
    model: doc.model,
    project: { id: doc.projectId, name: doc.projectName },
    amountUsd: priced ? round(doc.amountUsd as number) : null,
    currency: "USD",
    priced,
    pricingSource: doc.pricingSource,
    incurredAt: doc.incurredAt.toISOString(),
  };
}

// --------------------------------------------------
// FILTERS AND THE CHARGES LIST
// --------------------------------------------------

export type ChargeFilters = { platform?: string | null; model?: string | null; project?: string | null };

function chargeMatch(key: ApiKeyDoc, period: BillingPeriod, filters: ChargeFilters = {}): Record<string, unknown> {
  const match: Record<string, unknown> = {
    apiKeyId: key._id.toHexString(),
    incurredAt: { $gte: period.from, $lt: period.to },
  };
  if (filters.platform) match.provider = filters.platform === "replicate" ? { $in: ["replicate", null] } : filters.platform;
  if (filters.model) match.model = filters.model;
  if (filters.project) match.projectId = filters.project;
  return match;
}

export async function listCharges(
  key: ApiKeyDoc,
  period: BillingPeriod,
  options: { limit: number; cursor: string | null } & ChargeFilters
): Promise<{ data: ApiCharge[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit) || BILLING_PAGE_SIZE), BILLING_MAX_PAGE_SIZE);
  const filter = chargeMatch(key, period, options);
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    filter.$or = [{ incurredAt: { $lt: cursor.at } }, { incurredAt: cursor.at, _id: { $lt: cursor.id } }];
  }

  const docs = await (await expensesCollection())
    .find(filter as never)
    .sort({ incurredAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toApiCharge),
    nextCursor: docs.length > limit && last ? encodeCursor(last) : null,
  };
}

export async function allCharges(key: ApiKeyDoc, period: BillingPeriod): Promise<{ data: ApiCharge[]; truncated: boolean }> {
  const docs = await (await expensesCollection())
    .find(chargeMatch(key, period) as never)
    .sort({ incurredAt: 1, _id: 1 })
    .limit(STATEMENT_MAX_ROWS + 1)
    .toArray();
  return { data: docs.slice(0, STATEMENT_MAX_ROWS).map(toApiCharge), truncated: docs.length > STATEMENT_MAX_ROWS };
}

function encodeCursor(doc: Pick<ExpenseDoc, "_id" | "incurredAt">): string {
  return Buffer.from(JSON.stringify({ t: doc.incurredAt.toISOString(), id: doc._id })).toString("base64url");
}

function decodeCursor(value: string | null): { at: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as { t?: string; id?: string };
    const at = new Date(parsed.t ?? "");
    if (Number.isNaN(at.getTime()) || typeof parsed.id !== "string") return null;
    return { at, id: parsed.id };
  } catch {
    return null;
  }
}

// --------------------------------------------------
// THE SUMMARY: totals, by platform, model, project, day
// --------------------------------------------------

type Group = { id: string; name: string; amountUsd: number; runs: number; unpricedRuns: number };

const sums = {
  amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } },
  runs: { $sum: 1 },
  unpricedRuns: { $sum: { $cond: [{ $isNumber: "$amountUsd" }, 0, 1] } },
};

export async function billingSummary(key: ApiKeyDoc, period: BillingPeriod, now = new Date()) {
  const match = chargeMatch(key, period);
  const rows = await (await expensesCollection())
    .aggregate<{
      total: { amountUsd: number; runs: number; unpricedRuns: number }[];
      byPlatform: Group[];
      byModel: Group[];
      byProject: Group[];
      byDay: Group[];
    }>([
      { $match: match },
      {
        $facet: {
          total: [{ $group: { _id: null, ...sums } }],
          byPlatform: [{ $group: { _id: { $ifNull: ["$provider", "replicate"] }, ...sums } }, { $sort: { amountUsd: -1, _id: 1 } }],
          byModel: [{ $group: { _id: "$model", ...sums } }, { $sort: { amountUsd: -1, _id: 1 } }],
          byProject: [{ $group: { _id: "$projectId", name: { $last: "$projectName" }, ...sums } }, { $sort: { amountUsd: -1, _id: 1 } }],
          byDay: [
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$incurredAt", timezone: "UTC" } }, ...sums } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ])
    .toArray();
  const result = rows[0];
  const total = result?.total[0] ?? { amountUsd: 0, runs: 0, unpricedRuns: 0 };
  const shape = (list: (Group & { _id?: string })[] = [], withName = false) =>
    list.map((row) => ({
      id: String(row._id ?? ""),
      ...(withName ? { name: row.name ?? String(row._id ?? "") } : {}),
      amountUsd: round(row.amountUsd),
      runs: row.runs,
      unpricedRuns: row.unpricedRuns,
    }));

  // The cap and runs in flight belong to this month only
  const currentMonth = monthKey(now);
  const isCurrentMonth = period.label === currentMonth;
  const spend = isCurrentMonth ? await keySpend(key._id, currentMonth) : null;
  const cap = key.monthlyCapUsd;

  return {
    object: "billing_summary" as const,
    key: { id: key._id.toHexString(), name: key.name },
    period: { label: period.label, from: period.from.toISOString(), to: period.to.toISOString() },
    currency: "USD" as const,
    totalUsd: round(total.amountUsd),
    runs: total.runs,
    unpricedRuns: total.unpricedRuns,
    inFlight: spend ? { runs: spend.inFlight, estimatedUsd: spend.inFlightUsd } : null,
    cap:
      spend && cap !== null
        ? { monthlyUsd: cap, remainingUsd: round(Math.max(0, cap - spend.amountUsd - spend.inFlightUsd)), state: capState(spend, cap) }
        : null,
    byPlatform: shape(result?.byPlatform),
    byModel: shape(result?.byModel),
    byProject: shape(result?.byProject, true),
    byDay: shape(result?.byDay).map(({ id, ...rest }) => ({ date: id, ...rest })),
  };
}

// --------------------------------------------------
// MONTH BY MONTH (the last N months, this one included)
// --------------------------------------------------

export async function billingMonths(key: ApiKeyDoc, count: number, now = new Date()) {
  const months = Math.min(Math.max(1, Math.floor(count) || 12), 36);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const to = monthRange(monthKey(now)).to;
  const rows = await (await expensesCollection())
    .aggregate<Group & { _id: string }>([
      { $match: { apiKeyId: key._id.toHexString(), incurredAt: { $gte: first, $lt: to } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$incurredAt", timezone: "UTC" } }, ...sums } },
    ])
    .toArray();
  const byMonth = new Map(rows.map((row) => [row._id, row]));

  const data = [];
  for (let index = 0; index < months; index += 1) {
    const month = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)));
    const row = byMonth.get(month);
    data.push({ month, totalUsd: round(row?.amountUsd ?? 0), runs: row?.runs ?? 0, unpricedRuns: row?.unpricedRuns ?? 0 });
  }
  return { object: "list" as const, currency: "USD" as const, data };
}

// --------------------------------------------------
// THE STATEMENT AS CSV (for invoicing)
// --------------------------------------------------

// A cell that a spreadsheet could read as a formula is
// prefixed with ' (project and model names are typed by
// people)
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function statementCsv(charges: ApiCharge[]): string {
  const header = ["incurred_at", "charge_id", "generation_id", "platform", "model", "project_id", "project", "amount_usd", "priced", "pricing_source"];
  const lines = charges.map((charge) =>
    [
      charge.incurredAt,
      charge.id,
      charge.generationId,
      charge.platform,
      charge.model,
      charge.project.id,
      charge.project.name,
      charge.amountUsd === null ? null : charge.amountUsd.toFixed(6),
      charge.priced ? "yes" : "no",
      charge.pricingSource,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

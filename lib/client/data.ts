import { fetchJson } from "@/lib/client/http";
import type { CostAnalytics } from "@/lib/spend/cost-analytics";
import type { ExpensePage, ExpenseReport } from "@/lib/spend/expenses";
import type {
  HistoryPage,
  HistoryStatus,
  PublicGeneration,
} from "@/lib/generations";
import type { PublicProject } from "@/lib/auth/roles";

// --------------------------------------------------
// API READERS (browser only)
//
// The server scopes every list: users get their own
// generations and spend, admins and the super admin
// get the whole workspace.
// --------------------------------------------------

export type {
  HistoryPage,
  HistoryStatus,
  PublicGeneration,
} from "@/lib/generations";

export type HistoryFilters = {
  page?: number;
  pageSize?: number;
  project?: string;
  user?: string;
  model?: string;
  status?: HistoryStatus;
  q?: string;
  // Created between (ISO instants; to is exclusive)
  from?: string;
  to?: string;
  provider?: "replicate" | "higgsfield" | "elevenlabs";
  // Finished runs with a saved output of this kind
  kind?: "image" | "video" | "audio";
  // false: skip the filter dropdown values (see
  // listGenerations)
  withOptions?: boolean;
};

export type GenerationDetail = PublicGeneration & {
  inputs: Record<string, unknown>;
};

export async function fetchActiveProjects(): Promise<PublicProject[]> {
  const data = await fetchJson<{ projects?: PublicProject[] }>(
    "/api/projects"
  );

  return data.projects ?? [];
}

function historyQueryString(filters: HistoryFilters): string {
  const params = new URLSearchParams();

  const { withOptions, ...rest } = filters;

  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  }

  if (withOptions === false) params.set("options", "0");

  return params.toString();
}

export function fetchHistoryPage(
  filters: HistoryFilters = {}
): Promise<HistoryPage> {
  return fetchJson<HistoryPage>(
    `/api/generations?${historyQueryString(filters)}`
  );
}

// Super admin only (the server checks)
export async function setGenerationHidden(id: string, hidden: boolean): Promise<void> {
  await fetchJson(`/api/generations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
}

// Super admin only (the server checks)
export async function deleteGeneration(id: string): Promise<void> {
  await fetchJson(`/api/generations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Stops a running run on its platform; resolves to what
// it ended as ("canceled", or a result that came first)
export async function cancelGeneration(id: string): Promise<string> {
  const data = await fetchJson<{ status: string }>(`/api/predictions/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  return data.status;
}

export async function fetchGeneration(id: string): Promise<GenerationDetail> {
  const data = await fetchJson<{ generation: GenerationDetail }>(
    `/api/generations/${encodeURIComponent(id)}`
  );

  return data.generation;
}

// The viewer's local midnights for today, this week
// (from Sunday) and this month
export function localPeriods(now = new Date()) {
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - todayStart.getDay());

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return { todayStart, weekStart, monthStart };
}

// Expense filters as the API takes them: ids, and from/to
// as ISO instants (to is exclusive)
// Spend analytics for the Dashboard (lib/spend/cost-analytics.ts)
export async function fetchCostAnalytics(options: {
  from: Date;
  to: Date;
  monthStart: Date;
  provider?: "replicate" | "higgsfield" | "elevenlabs";
}): Promise<CostAnalytics> {
  const params = new URLSearchParams({
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    monthStart: options.monthStart.toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (options.provider) params.set("provider", options.provider);

  return fetchJson<CostAnalytics>(`/api/expenses/analytics?${params}`);
}

// Where a run was made (the Generate pages)
export type Platform = "" | "replicate" | "higgsfield" | "elevenlabs";

export const PLATFORMS: [Platform, string][] = [
  ["", "All platforms"],
  ["replicate", "Replicate"],
  ["higgsfield", "Higgsfield"],
  ["elevenlabs", "ElevenLabs"],
];

export function readPlatform(value: string | null): Platform {
  return PLATFORMS.some(([platform]) => platform === value) ? (value as Platform) : "";
}

export type ExpenseQuery = {
  project?: string;
  user?: string;
  model?: string;
  provider?: "replicate" | "higgsfield" | "elevenlabs";
  from?: string;
  to?: string;
};

function expenseParams(filters: ExpenseQuery) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  return params;
}

// Totals are aggregated on the server; we only send the
// viewer's local midnights so "today", "this week" and
// "this month" match their timezone.
//
// withEntries: false skips the ledger entries (totals
// only, for the dashboard)
export function fetchExpenseReport({
  withEntries = true,
  filters = {},
}: { withEntries?: boolean; filters?: ExpenseQuery } = {}): Promise<ExpenseReport> {
  const { todayStart, weekStart, monthStart } = localPeriods();
  const params = expenseParams(filters);

  params.set("todayStart", todayStart.toISOString());
  params.set("weekStart", weekStart.toISOString());
  params.set("monthStart", monthStart.toISOString());

  if (!withEntries) params.set("entries", "0");

  return fetchJson<ExpenseReport>(`/api/expenses?${params}`);
}

// One numbered page of entries (1-based), same filters
export function fetchExpensesPage(
  page: number,
  filters: ExpenseQuery = {}
): Promise<ExpensePage> {
  const params = expenseParams(filters);
  params.set("page", String(page));

  return fetchJson<ExpensePage>(`/api/expenses/entries?${params}`);
}

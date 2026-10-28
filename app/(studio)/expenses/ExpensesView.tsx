"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, formatCost } from "@/app/components/ui/primitives";
import { fetchExpenseReport, fetchExpensesPage, readPlatform } from "@/lib/client/data";
import type { SpendGroup, SpendTotal } from "@/lib/spend/expenses";
import { canManageUsers } from "@/lib/auth/roles";
import ExpenseFilters, {
  RANGES,
  toExpenseQuery,
  type ExpenseFilterValues,
  type ExpenseRange,
} from "./ExpenseFilters";

// --------------------------------------------------
// EXPENSES (MongoDB ledger via /api/expenses)
// --------------------------------------------------

// Grey bars in the shape of the rows while loading
function SkeletonRows({ count, columns }: { count: number; columns: string[] }) {
  return (
    <div className="divide-y divide-line" aria-hidden="true">
      {Array.from({ length: count }, (_, row) => (
        <div key={row} className="flex items-center justify-between gap-4 px-5 py-4">
          {columns.map((width, column) => (
            <div
              key={column}
              className={`h-3.5 animate-pulse rounded bg-raised ${width}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Spend grouped by project or user; groups is null
// until loaded
function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: SpendGroup[] | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-5 py-4 font-semibold">
        {title}
      </div>

      {!groups ? (
        <SkeletonRows count={3} columns={["w-1/3", "w-14"]} />
      ) : !groups.length ? (
        <div className="p-8 text-center text-sm text-fg-subtle">
          No spend yet.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">{group.name}</p>

                <p className="mt-0.5 text-xs text-fg-subtle">
                  {group.count} billed
                  {group.unpriced ? ` · ${group.unpriced} unpriced` : ""}
                </p>
              </div>

              <span className="text-sm text-fg">
                {formatCost(group.amountUsd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Entries per page (the server's EXPENSE_PAGE_SIZE: the
// report brings the first page)
const PAGE_SIZE = 50;

const FILTER_KEYS = ["platform", "project", "user", "model", "range", "from", "to"] as const;

function readFilters(params: URLSearchParams): ExpenseFilterValues {
  const range = params.get("range") as ExpenseRange | null;

  return {
    project: params.get("project") ?? "",
    user: params.get("user") ?? "",
    model: params.get("model") ?? "",
    platform: readPlatform(params.get("platform")),
    range: range && RANGES.some(([value]) => value === range) ? range : "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

// "Oct 1 – Oct 22" for a custom range
function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function rangeLabel(values: ExpenseFilterValues) {
  if (values.range === "custom") {
    if (values.from && values.to) {
      return `${formatDay(values.from)} – ${formatDay(values.to)}`;
    }
    if (values.from) return `Since ${formatDay(values.from)}`;
    if (values.to) return `Until ${formatDay(values.to)}`;
    return "All time";
  }

  return RANGES.find(([value]) => value === values.range)?.[1] ?? "All time";
}

export default function ExpensesView() {
  const { currentUser } = useStudio();
  const isManagerView = canManageUsers(currentUser);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = readFilters(searchParams);
  const query = toExpenseQuery(filters);
  const filtered = FILTER_KEYS.some((key) => filters[key]);

  // Filter changes replace the history entry, like
  // History's filters (the custom dates only matter with
  // the custom range)
  // The address as last asked for: two quick changes
  // (e.g. both custom dates) build on each other
  const latestQuery = useRef(searchParams.toString());
  useEffect(() => {
    latestQuery.current = searchParams.toString();
  }, [searchParams]);

  const changeFilters = useCallback(
    (patch: Partial<ExpenseFilterValues>) => {
      const next = new URLSearchParams(latestQuery.current);

      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }

      if (next.get("range") !== "custom") {
        next.delete("from");
        next.delete("to");
      }
      // New filters start from the first page
      next.delete("page");

      const search = next.toString();
      latestQuery.current = search;
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router]
  );

  const clearFilters = () => {
    latestQuery.current = "";
    router.replace(pathname, { scroll: false });
  };

  const queryKey = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]))
  ).toString();

  const {
    data: report,
    error,
    stale,
  } = useApiData(
    `expenses:report:${queryKey}`,
    () => fetchExpenseReport({ filters: query }),
    "Unable to load expenses."
  );

  // Numbered pages of the history. The first comes with
  // the report; the selection's count says how many there
  // are. The page is in the URL, like History's.
  const entryCount = report?.totals.selected.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(entryCount / PAGE_SIZE));
  const requestedPage = Math.floor(Number(searchParams.get("page")));
  const page = Number.isFinite(requestedPage) && requestedPage > 1 ? requestedPage : 1;

  const laterPage = useApiData(
    page > 1 ? `expenses:page:${queryKey}:${page}` : "expenses:page:none",
    () => (page > 1 ? fetchExpensesPage(page, query) : Promise.resolve(null)),
    "Unable to load this page of expenses."
  );

  const entries = page > 1 ? (laterPage.data?.entries ?? []) : (report?.entries ?? []);
  const entriesLoading = page > 1 ? laterPage.loading : !report;
  const first = entryCount ? (Math.min(page, pageCount) - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, entryCount);

  const historyTop = useRef<HTMLDivElement>(null);

  function goToPage(next: number) {
    const params = new URLSearchParams(latestQuery.current);
    if (next > 1) params.set("page", String(next));
    else params.delete("page");
    const search = params.toString();
    latestQuery.current = search;
    router.push(search ? `${pathname}?${search}` : pathname, { scroll: false });
    historyTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const cards: [string, SpendTotal | undefined][] = [
    ["This month", report?.totals.month],
    ["This week", report?.totals.week],
    ["Today", report?.totals.today],
    // The selected range ("All time" when none)
    [
      filters.range ? `Selected · ${rangeLabel(filters)}` : "All time",
      report?.totals.selected,
    ],
  ];

  const unpricedTotal = report?.totals.selected.unpriced ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Spend
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Expenses
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          {isManagerView
            ? "Workspace AI spend, from the expense ledger."
            : "Your AI spend, from the expense ledger."}
        </p>
      </div>

      <ExpenseFilters
        values={filters}
        options={report?.options}
        showUser={isManagerView}
        onChange={changeFilters}
        onClear={clearFilters}
      />

      {error && <Alert>{error}</Alert>}

      {/* Dimmed while new filters load */}
      <div
        aria-busy={stale}
        className={cx("space-y-6 transition-opacity", stale && "opacity-60")}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map(([title, total]) => (
            <div
              key={title}
              className="rounded-2xl border border-line bg-surface p-5"
            >
              <p className="text-xs text-fg-subtle">{title}</p>

              {total ? (
                <>
                  <p className="mt-3 text-2xl font-semibold">
                    {formatCost(total.amountUsd)}
                  </p>

                  <p className="mt-1 text-xs text-fg-subtle">
                    {total.count} billed
                  </p>
                </>
              ) : (
                <div aria-hidden="true">
                  <div className="mt-3.5 h-6 w-24 animate-pulse rounded bg-raised" />
                  <div className="mt-2.5 h-3 w-14 animate-pulse rounded bg-raised" />
                </div>
              )}
            </div>
          ))}
        </div>

        {unpricedTotal > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {unpricedTotal} billed generation
            {unpricedTotal === 1 ? " has" : "s have"} no known price (model not
            in the price table) and {unpricedTotal === 1 ? "is" : "are"} counted
            as $0.
          </div>
        )}

        <div className={`grid gap-6 ${isManagerView ? "lg:grid-cols-2" : ""}`}>
          <GroupTable title="By project" groups={report?.byProject ?? null} />

          {isManagerView && (
            <GroupTable title="By user" groups={report?.byUser ?? null} />
          )}
        </div>

        <div ref={historyTop} className="scroll-mt-20 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
            <span className="font-semibold">Expense history</span>

            {report && (
              <span className="text-xs text-fg-subtle">
                {entryCount > PAGE_SIZE && `Showing ${first}–${last} of `}
                {entryCount} billed · {formatCost(report.totals.selected.amountUsd)}
              </span>
            )}
          </div>

          {laterPage.error && page > 1 && (
            <div className="px-5 pt-4">
              <Alert>{laterPage.error}</Alert>
            </div>
          )}

          {entriesLoading ? (
            error ? (
              <div className="p-10 text-center text-sm text-fg-subtle">
                Expenses could not be loaded.
              </div>
            ) : (
              <SkeletonRows count={6} columns={["w-1/5", "w-1/6", "w-1/5", "w-1/6", "w-12"]} />
            )
          ) : !entries.length ? (
            <div className="p-10 text-center text-sm text-fg-subtle">
              {page > pageCount && entryCount
                ? "There's nothing on this page."
                : filtered
                  ? "No expenses match these filters."
                  : "No expenses yet."}
            </div>
          ) : (
            <div
              className={cx("divide-y divide-line transition-opacity", laterPage.refreshing && "opacity-60")}
            >
              {entries.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-5"
                >
                  <span className="text-sm text-fg">{item.project}</span>

                  <span className="text-sm text-fg-muted">{item.user}</span>

                  <span className="truncate text-sm text-fg-muted">
                    {item.model}
                  </span>

                  <span className="text-xs text-fg-subtle">
                    {new Date(item.incurredAt).toLocaleString()}
                  </span>

                  <span className="text-right text-sm text-fg">
                    {item.amountUsd === null
                      ? "unpriced"
                      : formatCost(item.amountUsd)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {report && pageCount > 1 && (
            <nav
              aria-label="Expense history pages"
              className="flex items-center justify-between gap-3 border-t border-line px-5 py-3"
            >
              <Button size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                Previous
              </Button>

              <span className="text-sm text-fg-muted">
                Page {Math.min(page, pageCount)} of {pageCount}
              </span>

              <Button size="sm" disabled={page >= pageCount} onClick={() => goToPage(Math.min(pageCount, page + 1))}>
                Next
                <Icon name="chevronRight" size={16} />
              </Button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

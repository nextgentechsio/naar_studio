"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Alert, Button, cx, formatCost } from "@/app/components/ui/primitives";
import { fetchExpenseReport, fetchMoreExpenses } from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import type { ExpensePage, SpendGroup, SpendTotal } from "@/lib/expenses";
import { canManageUsers } from "@/lib/roles";
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

const FILTER_KEYS = ["project", "user", "model", "range", "from", "to"] as const;

function readFilters(params: URLSearchParams): ExpenseFilterValues {
  const range = params.get("range") as ExpenseRange | null;

  return {
    project: params.get("project") ?? "",
    user: params.get("user") ?? "",
    model: params.get("model") ?? "",
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
  const changeFilters = useCallback(
    (patch: Partial<ExpenseFilterValues>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }

      if (next.get("range") !== "custom") {
        next.delete("from");
        next.delete("to");
      }

      const search = next.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams]
  );

  const clearFilters = () => router.replace(pathname, { scroll: false });

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

  // Pages after the first, from "Load more". Tied to the
  // report they continue, so a fresher report starts over.
  const [more, setMore] = useState<{
    after: ExpensePage | null;
    pages: ExpensePage[];
  }>({ after: null, pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  const extraPages = more.after === report ? more.pages : [];
  const entries = [
    ...(report?.entries ?? []),
    ...extraPages.flatMap((page) => page.entries),
  ];
  const nextCursor = extraPages.length
    ? extraPages[extraPages.length - 1].nextCursor
    : (report?.nextCursor ?? null);

  async function loadMore() {
    if (!nextCursor || !report) return;

    setLoadingMore(true);
    setMoreError("");

    try {
      const page = await fetchMoreExpenses(nextCursor, query);
      setMore({ after: report, pages: [...extraPages, page] });
    } catch (err) {
      setMoreError(errorMessage(err, "Unable to load more expenses."));
    } finally {
      setLoadingMore(false);
    }
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

        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
            <span className="font-semibold">Expense history</span>

            {report && (
              <span className="text-xs text-fg-subtle">
                {report.totals.selected.count} billed ·{" "}
                {formatCost(report.totals.selected.amountUsd)}
              </span>
            )}
          </div>

          {!report ? (
            error ? (
              <div className="p-10 text-center text-sm text-fg-subtle">
                Expenses could not be loaded.
              </div>
            ) : (
              <SkeletonRows count={6} columns={["w-1/5", "w-1/6", "w-1/5", "w-1/6", "w-12"]} />
            )
          ) : !entries.length ? (
            <div className="p-10 text-center text-sm text-fg-subtle">
              {filtered ? "No expenses match these filters." : "No expenses yet."}
            </div>
          ) : (
            <div className="divide-y divide-line">
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

          {/* The first 50 come with the report; older ones
              on request */}
          {report && (nextCursor || moreError) && (
            <div className="flex flex-col items-center gap-2 border-t border-line px-5 py-4">
              {moreError && <p className="text-sm text-danger">{moreError}</p>}

              {nextCursor && (
                <Button size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

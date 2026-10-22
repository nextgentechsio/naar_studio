"use client";

import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Alert } from "@/app/components/ui/primitives";
import { fetchExpenseReport, fetchHistoryPage } from "@/lib/client/data";

// Totals come from the paged history API: the latest 5
// plus the overall and succeeded counts (no filter
// dropdown values needed)
async function fetchDashboardHistory() {
  const [latest, succeeded] = await Promise.all([
    fetchHistoryPage({ pageSize: 5, withOptions: false }),
    fetchHistoryPage({ pageSize: 1, status: "succeeded", withOptions: false }),
  ]);

  return {
    recent: latest.generations,
    total: latest.total,
    succeeded: succeeded.total,
  };
}

// Totals only: the entries aren't shown here
const fetchSpendTotals = () => fetchExpenseReport({ withEntries: false });

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

function formatUsd4(amount: number | null) {
  return amount === null ? "—" : `$${amount.toFixed(4)}`;
}

// Grey row placeholders while a list loads
function SkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex items-center justify-between rounded-xl bg-sunken p-3"
        >
          <div className="w-1/2 space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-raised" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-raised" />
          </div>
          <div className="h-3 w-14 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </>
  );
}

export default function DashboardView() {
  const { projects } = useStudio();

  const history = useApiData(
    "dashboard:history",
    fetchDashboardHistory,
    "Unable to load history."
  );
  const expenses = useApiData(
    "dashboard:spend",
    fetchSpendTotals,
    "Unable to load expenses."
  );

  const generations = history.data?.recent ?? [];
  const report = expenses.data;

  const total = history.data?.total ?? 0;
  const successful = history.data?.succeeded ?? 0;

  // Spend comes from the MongoDB expense ledger
  const totalSpend = report?.totals.allTime.amountUsd ?? null;
  const todaySpend = report?.totals.today.amountUsd ?? null;

  const projectSpend = projects.map((item) => {
    const group = report?.byProject.find((entry) => entry.id === item.id);

    return {
      name: item.name,
      count: group?.count ?? 0,
      cost: group?.amountUsd ?? 0,
    };
  });

  const error = history.error || expenses.error;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">
          Spend
        </p>

        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">
          Dashboard
        </h1>

        <p className="mt-1 text-sm text-fg-muted">
          AI generation workspace overview
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(
          [
            // A placeholder bar while loading; "—" if it
            // failed, never a misleading "0"
            ["Total Generations", history, history.data ? String(total) : "—"],
            ["Total Spend", expenses, formatUsd4(totalSpend)],
            ["Today", expenses, formatUsd4(todaySpend)],
            [
              "Success Rate",
              history,
              total ? `${Math.round((successful / total) * 100)}%` : "—",
            ],
          ] as const
        ).map(([title, source, value]) => (
          <div
            key={title}
            className="rounded-2xl border border-line bg-surface p-5"
          >
            <p className="text-xs uppercase tracking-wider text-fg-subtle">
              {title}
            </p>

            {source.loading ? (
              <div
                aria-hidden="true"
                className="mt-4 h-8 w-24 animate-pulse rounded bg-raised"
              />
            ) : (
              <p className="mt-4 text-2xl font-semibold">{value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Recent generations</h2>

          <div className="mt-5 space-y-3">
            {history.loading && <SkeletonList count={5} />}

            {generations.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl bg-sunken p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{item.model}</p>

                  <p className="mt-1 text-xs text-fg-subtle">
                    {item.project} · {item.user}
                  </p>
                </div>

                <span className="text-xs text-fg-muted">
                  {formatUsd4(item.costUsd)}
                </span>
              </div>
            ))}

            {!history.loading && !generations.length && (
              <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">
                No generation history yet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Project usage</h2>

          <div className="mt-5 space-y-3">
            {expenses.loading && <SkeletonList count={Math.min(projects.length || 3, 6)} />}

            {!expenses.loading && projectSpend.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-xl bg-sunken px-4 py-3"
              >
                <div>
                  <span className="text-sm text-fg-muted">{item.name}</span>

                  <span className="ml-2 text-xs text-fg-subtle">
                    {item.count} generations
                  </span>
                </div>

                <span className="text-xs text-fg-muted">
                  {formatUsd4(item.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

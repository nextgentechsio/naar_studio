"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { useApiData } from "@/app/(studio)/_components/useApiData";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, cx, formatCost } from "@/app/components/ui/primitives";
import {
  fetchCostAnalytics,
  fetchHistoryPage,
  PLATFORMS,
  readPlatform,
  type Platform,
} from "@/lib/client/data";
import {
  DASHBOARD_RANGES,
  dashboardPeriod,
  readDashboardRange,
} from "@/lib/client/date-range";
import { formatDateTime } from "@/lib/client/format";
import type { CostAnalytics } from "@/lib/spend/cost-analytics";
import { modelLabel } from "@/lib/replicate/catalog";
import { canManageUsers } from "@/lib/auth/roles";
import { BarList, SpendColumns, ViewSwitch, type DayValues, type Series } from "./charts";

// --------------------------------------------------
// DASHBOARD: spend and run analytics
//
// One filter row (platform, period) scopes everything
// below it: KPIs against the previous period of the same
// length, spend per day by platform, where the money
// goes (model, project, person), per-model unit costs,
// and the most expensive runs. "Recent generations" is
// the latest runs, whatever the period.
// --------------------------------------------------

type ProviderKey = "replicate" | "higgsfield";

const SERIES: Series<ProviderKey>[] = [
  { key: "replicate", label: "Replicate", color: "var(--viz-1)" },
  { key: "higgsfield", label: "Higgsfield", color: "var(--viz-2)" },
];

const PROVIDER_LABEL: Record<ProviderKey, string> = { replicate: "Replicate", higgsfield: "Higgsfield" };
const PROVIDER_COLOR: Record<ProviderKey, string> = { replicate: "var(--viz-1)", higgsfield: "var(--viz-2)" };

// Rows past this many fold into "Other"
const TOP_ROWS = 6;

async function fetchRecent(platform: Platform) {
  const page = await fetchHistoryPage({ pageSize: 6, provider: platform || undefined, withOptions: false });
  return page.generations;
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// --------------------------------------------------
// STAT TILE: value, then change against the previous
// period (colored by whether that's good)
// --------------------------------------------------

function Delta({ current, previous, upIsGood }: { current: number; previous: number; upIsGood: boolean }) {
  if (!(previous > 0)) {
    return <span className="text-fg-subtle">{current > 0 ? "New this period" : "No change"}</span>;
  }

  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return <span className="text-fg-subtle">Same as before</span>;

  const up = change > 0;
  const good = up === upIsGood;

  return (
    <span className={cx("inline-flex items-center gap-1 font-medium", good ? "text-success" : "text-danger")}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(Math.round(change * 100))}%
      <span className="font-normal text-fg-subtle">vs previous period</span>
    </span>
  );
}

function StatTile({
  label,
  value,
  footer,
  loading,
}: {
  label: string;
  value: ReactNode;
  footer?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      {loading ? (
        <>
          <div aria-hidden className="ui-skeleton mt-3 h-8 w-28 rounded" />
          <div aria-hidden className="ui-skeleton mt-3 h-3 w-36 rounded" />
        </>
      ) : (
        <>
          <p className="mt-2 text-[28px] font-semibold leading-tight text-fg">{value}</p>
          {footer && <p className="mt-2 text-xs">{footer}</p>}
        </>
      )}
    </div>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface p-5 shadow-card", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PlatformDot({ provider }: { provider: ProviderKey }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-muted">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLOR[provider] }} />
      {PROVIDER_LABEL[provider]}
    </span>
  );
}

// Top rows, the rest as one "Other" row
function foldRows<T>(rows: T[], value: (row: T) => number) {
  if (rows.length <= TOP_ROWS + 1) return { top: rows, other: null };
  const rest = rows.slice(TOP_ROWS);
  return {
    top: rows.slice(0, TOP_ROWS),
    other: { count: rest.length, value: rest.reduce((sum, row) => sum + value(row), 0) },
  };
}

// --------------------------------------------------

export default function DashboardView() {
  const { currentUser } = useStudio();
  const isManager = canManageUsers(currentUser);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const platform = readPlatform(searchParams.get("platform"));
  const range = readDashboardRange(searchParams.get("range"));

  function setFilter(key: "platform" | "range", value: string) {
    const next = new URLSearchParams(searchParams.toString());
    // The defaults stay out of the address
    if (!value || (key === "range" && value === "30d")) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const period = dashboardPeriod(range);
  const provider = platform || undefined;

  const analytics = useApiData<CostAnalytics>(
    `dashboard:analytics:${platform}:${range}:${period.days[0]}`,
    () => fetchCostAnalytics({ from: period.from, to: period.to, monthStart: period.monthStart, provider }),
    "Unable to load cost analytics.",
  );
  const recent = useApiData(`dashboard:recent:${platform}`, () => fetchRecent(platform), "Unable to load history.");

  const [trendTable, setTrendTable] = useState(false);
  // The per-model card opens on its table
  const [modelChart, setModelChart] = useState(false);

  const data = analytics.data;
  const loading = analytics.loading;
  const series = platform ? SERIES.filter((item) => item.key === platform) : SERIES;

  // Every day of the period, zeros included
  const byDay = new Map(data?.days.map((day) => [day.day, day]) ?? []);
  const days: DayValues<ProviderKey>[] = period.days.map(
    (day) => byDay.get(day) ?? { day, replicate: 0, higgsfield: 0, runs: 0 },
  );

  // Per priced run
  const pricedRuns = (total: { count: number; unpriced: number }) => total.count - total.unpriced;
  const average = data && pricedRuns(data.total) > 0 ? data.total.amountUsd / pricedRuns(data.total) : null;
  const previousAverage =
    data && pricedRuns(data.previous) > 0 ? data.previous.amountUsd / pricedRuns(data.previous) : 0;

  const finished = data ? data.outcomes.succeeded + data.outcomes.failed : 0;

  // Month-end forecast at this month's daily rate so far
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthDaysSoFar = now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440;
  const forecast =
    data && monthDaysSoFar > 0.25 ? (data.monthToDate.amountUsd / monthDaysSoFar) * daysInMonth : null;

  const models = foldRows(data?.byModel ?? [], (row) => row.amountUsd);
  const projects = foldRows(data?.byProject ?? [], (row) => row.amountUsd);
  const people = foldRows(data?.byUser ?? [], (row) => row.amountUsd);
  const totalSpend = data?.total.amountUsd ?? 0;

  const rangeLabel = DASHBOARD_RANGES.find(([value]) => value === range)?.[1] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">Spend</p>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[32px]">Dashboard</h1>
        <p className="mt-1 text-sm text-fg-muted">Where the money goes, and how runs are doing</p>
      </div>

      {/* One row of filters scoping everything below */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Period"
          className="inline-flex rounded-full border border-line bg-surface p-1 shadow-card"
        >
          {DASHBOARD_RANGES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setFilter("range", value)}
              className={cx(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                range === value ? "bg-accent text-on-accent shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Platform"
          className="inline-flex rounded-full border border-line bg-surface p-1 shadow-card"
        >
          {PLATFORMS.map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={platform === value}
              onClick={() => setFilter("platform", value)}
              className={cx(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                platform === value ? "bg-accent text-on-accent shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {value && (
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: PROVIDER_COLOR[value] }} />
              )}
              {value ? label : "All platforms"}
            </button>
          ))}
        </div>
      </div>

      {analytics.error && <Alert>{analytics.error}</Alert>}

      {data && data.total.unpriced > 0 && (
        <Alert tone="warning">
          {data.total.unpriced} billed run{data.total.unpriced === 1 ? " has" : "s have"} no known price in this
          period and {data.total.unpriced === 1 ? "is" : "are"} counted as $0, so spend may be higher.
        </Alert>
      )}

      {/* Held at reduced opacity while a new slice loads */}
      <div className={cx("space-y-6 transition-opacity", analytics.refreshing && "opacity-60")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={`Spend · ${rangeLabel.toLowerCase()}`}
            loading={loading}
            value={formatCost(data?.total.amountUsd ?? 0)}
            footer={
              data && (
                <Delta current={data.total.amountUsd} previous={data.previous.amountUsd} upIsGood={false} />
              )
            }
          />
          <StatTile
            label="Average cost per run"
            loading={loading}
            value={average === null ? "—" : formatCost(average)}
            footer={
              data &&
              (average === null ? (
                <span className="text-fg-subtle">No priced runs</span>
              ) : (
                <Delta current={average} previous={previousAverage} upIsGood={false} />
              ))
            }
          />
          <StatTile
            label="Success rate"
            loading={loading}
            value={finished ? `${percent(data!.outcomes.succeeded, finished)}%` : "—"}
            footer={
              data && (
                <span className="text-fg-subtle">
                  {data.outcomes.succeeded} succeeded · {data.outcomes.failed} failed
                  {data.outcomes.running ? ` · ${data.outcomes.running} running` : ""}
                </span>
              )
            }
          />
          <StatTile
            label="This month, forecast"
            loading={loading}
            value={forecast === null ? "—" : formatCost(forecast)}
            footer={
              data && (
                <span className="text-fg-subtle">
                  {formatCost(data.monthToDate.amountUsd)} so far, at this month&apos;s daily rate
                </span>
              )
            }
          />
        </div>

        <Card
          title="Spend per day"
          subtitle={
            data &&
            (platform
              ? `${data.total.count} billed runs`
              : `Replicate ${formatCost(data.byProvider.replicate.amountUsd)} (${percent(data.byProvider.replicate.amountUsd, totalSpend)}%) · Higgsfield ${formatCost(data.byProvider.higgsfield.amountUsd)} (${percent(data.byProvider.higgsfield.amountUsd, totalSpend)}%)`)
          }
          action={<ViewSwitch table={trendTable} onChange={setTrendTable} />}
        >
          {loading ? (
            <div aria-hidden className="ui-skeleton h-[230px] rounded-lg" />
          ) : (
            <SpendColumns days={days} series={series} table={trendTable} />
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Spend by model" subtitle="Colored by platform">
            {loading ? (
              <div aria-hidden className="ui-skeleton h-48 rounded-lg" />
            ) : (
              <BarList
                empty="No spend in this period."
                rows={[
                  ...models.top.map((row) => ({
                    key: row.model,
                    label: (
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[row.provider] }} />
                        <span className="truncate" title={row.model}>{modelLabel(row.model)}</span>
                      </span>
                    ),
                    detail: `${row.runs} run${row.runs === 1 ? "" : "s"} · ${percent(row.amountUsd, totalSpend)}% of spend${row.unpriced ? ` · ${row.unpriced} unpriced` : ""}`,
                    value: row.amountUsd,
                    color: PROVIDER_COLOR[row.provider],
                  })),
                  ...(models.other
                    ? [{ key: "other", label: `Other (${models.other.count} models)`, value: models.other.value, color: "var(--fg-subtle)" }]
                    : []),
                ]}
              />
            )}
          </Card>

          <Card title={isManager ? "Spend by project and person" : "Spend by project"}>
            {loading ? (
              <div aria-hidden className="ui-skeleton h-48 rounded-lg" />
            ) : (
              <div className="space-y-6">
                <BarList
                  empty="No spend in this period."
                  rows={[
                    ...projects.top.map((row) => ({
                      key: row.id,
                      label: row.name,
                      detail: `${row.count} run${row.count === 1 ? "" : "s"} · ${percent(row.amountUsd, totalSpend)}%`,
                      value: row.amountUsd,
                      color: "var(--fg-muted)",
                    })),
                    ...(projects.other
                      ? [{ key: "other", label: `Other (${projects.other.count} projects)`, value: projects.other.value, color: "var(--fg-subtle)" }]
                      : []),
                  ]}
                />
                {isManager && (data?.byUser.length ?? 0) > 0 && (
                  <div className="border-t border-line pt-5">
                    <p className="mb-3 text-xs font-medium text-fg-subtle">By person</p>
                    <BarList
                      empty=""
                      rows={[
                        ...people.top.map((row) => ({
                          key: row.id,
                          label: row.name,
                          detail: `${row.count} run${row.count === 1 ? "" : "s"} · ${percent(row.amountUsd, totalSpend)}%`,
                          value: row.amountUsd,
                          color: "var(--fg-muted)",
                        })),
                        ...(people.other
                          ? [{ key: "other", label: `Other (${people.other.count} people)`, value: people.other.value, color: "var(--fg-subtle)" }]
                          : []),
                      ]}
                    />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card
          title="Cost per model"
          subtitle="What each model costs per run, for picking cheaper options"
          action={<ViewSwitch table={!modelChart} onChange={(table) => setModelChart(!table)} />}
        >
          {loading ? (
            <div aria-hidden className="ui-skeleton h-40 rounded-lg" />
          ) : !data?.byModel.length ? (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">No spend in this period.</p>
          ) : modelChart ? (
            // "Chart": average per run, one bar per model
            <BarList
              empty=""
              rows={[...data.byModel]
                .filter((row) => row.averageUsd !== null)
                .sort((a, b) => (b.averageUsd ?? 0) - (a.averageUsd ?? 0))
                .slice(0, 10)
                .map((row) => ({
                  key: row.model,
                  label: modelLabel(row.model),
                  detail: `average per run · ${row.runs} runs`,
                  value: row.averageUsd ?? 0,
                  color: PROVIDER_COLOR[row.provider],
                }))}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-fg-subtle">
                  <tr>
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Platform</th>
                    <th className="pb-2 text-right font-medium">Runs</th>
                    <th className="pb-2 text-right font-medium">Spend</th>
                    <th className="pb-2 text-right font-medium">Per run</th>
                    <th className="pb-2 text-right font-medium">Most expensive</th>
                    <th className="pb-2 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.byModel.map((row) => (
                    <tr key={row.model} className="border-t border-line">
                      <td className="max-w-64 truncate py-2 pr-3 text-fg" title={row.model}>{modelLabel(row.model)}</td>
                      <td className="py-2 pr-3 text-xs"><PlatformDot provider={row.provider} /></td>
                      <td className="py-2 text-right text-fg-muted">
                        {row.runs}
                        {row.unpriced ? <span className="text-fg-subtle"> ({row.unpriced} unpriced)</span> : null}
                      </td>
                      <td className="py-2 text-right font-medium text-fg">{formatCost(row.amountUsd)}</td>
                      <td className="py-2 text-right text-fg">{row.averageUsd === null ? "—" : formatCost(row.averageUsd)}</td>
                      <td className="py-2 text-right text-fg-muted">{row.maxUsd === null ? "—" : formatCost(row.maxUsd)}</td>
                      <td className="py-2 text-right text-fg-muted">{percent(row.amountUsd, totalSpend)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Most expensive runs" subtitle={`In the ${rangeLabel.toLowerCase()}`}>
            {loading ? (
              <div aria-hidden className="ui-skeleton h-48 rounded-lg" />
            ) : !data?.topRuns.length ? (
              <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">No spend in this period.</p>
            ) : (
              <ol className="space-y-2">
                {data.topRuns.map((run, index) => (
                  <li key={run.id}>
                    <Link
                      href={`/history?view=${encodeURIComponent(run.id)}`}
                      className="group flex items-center gap-3 rounded-xl bg-sunken px-3 py-2.5 transition-colors hover:bg-raised"
                    >
                      <span className="w-4 shrink-0 text-xs tabular-nums text-fg-subtle">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[run.provider] }} />
                          <span className="truncate">{modelLabel(run.model)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                          {run.project}
                          {isManager ? ` · ${run.user}` : ""} · {formatDateTime(run.incurredAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-fg">{formatCost(run.amountUsd)}</span>
                      <Icon name="chevronRight" size={14} className="shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Recent generations" subtitle="Latest runs, any period">
            {recent.loading ? (
              <div aria-hidden className="ui-skeleton h-48 rounded-lg" />
            ) : recent.error ? (
              <Alert>{recent.error}</Alert>
            ) : !recent.data?.length ? (
              <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-subtle">No generation history yet.</p>
            ) : (
              <ul className="space-y-2">
                {recent.data.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/history?view=${encodeURIComponent(item.id)}`}
                      className="flex items-center justify-between gap-3 rounded-xl bg-sunken px-3 py-2.5 transition-colors hover:bg-raised"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[item.provider] }} />
                          <span className="truncate">{modelLabel(item.model)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                          {item.project} · {item.user} · {formatDateTime(item.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                        {item.status === "succeeded" ? formatCost(item.costUsd) : item.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

import type { Filter } from "mongodb";
import {
  dimensionFilter,
  ensureBackfilled,
  groupStages,
  readGroups,
  readTotal,
  totalStages,
  type SpendGroup,
  type SpendTotal,
} from "@/lib/spend/expenses";
import { ensureHiggsfieldCostsSynced } from "@/lib/spend/higgsfield-billing";
import {
  expensesCollection,
  generationsCollection,
  providerMatch,
  type ExpenseDoc,
  type GenerationDoc,
  type Provider,
} from "@/lib/db/mongodb";
import { currentNames } from "@/lib/names";
import { canHideGenerations, canManageUsers } from "@/lib/auth/roles";
import type { StoredUser } from "@/lib/auth/users";

// --------------------------------------------------
// COST ANALYTICS (the Dashboard)
//
// Spend over a period from the expense ledger, with the
// breakdowns a cost review needs: per day (in the
// viewer's timezone) and platform, per model, project
// and person, the same-length period before it, month to
// date, the most expensive runs, and how many runs
// succeeded or failed (from the generations; failures
// are never billed).
//
// Visibility follows the Expenses page: users see their
// own spend; admins and the super admin see everyone's.
// Hidden runs count in spend, but only the super admin
// sees them among the runs.
// --------------------------------------------------

export type DaySpend = {
  // YYYY-MM-DD in the viewer's timezone
  day: string;
  replicate: number;
  higgsfield: number;
  elevenlabs: number;
  runs: number;
};

export type ModelSpend = {
  model: string;
  provider: Provider;
  runs: number;
  amountUsd: number;
  unpriced: number;
  // Per priced run
  averageUsd: number | null;
  maxUsd: number | null;
};

export type TopRun = {
  id: string;
  model: string;
  provider: Provider;
  project: string;
  user: string;
  amountUsd: number;
  incurredAt: string;
};

export type CostAnalytics = {
  from: string;
  to: string;
  total: SpendTotal;
  previous: SpendTotal;
  monthToDate: SpendTotal;
  days: DaySpend[];
  byProvider: Record<Provider, SpendTotal>;
  byModel: ModelSpend[];
  byProject: SpendGroup[];
  // Managers only (empty for users)
  byUser: SpendGroup[];
  topRuns: TopRun[];
  outcomes: { total: number; succeeded: number; failed: number; running: number };
};

export type AnalyticsQuery = {
  from: Date;
  to: Date;
  // The viewer's local midnight on the 1st of this month
  monthStart: Date;
  // IANA name, e.g. "Asia/Kolkata"
  timeZone: string;
  provider?: Provider;
};

const TOP_RUNS = 5;

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function getCostAnalytics(
  actor: StoredUser,
  query: AnalyticsQuery
): Promise<CostAnalytics> {
  await ensureBackfilled();
  // After the backfill, so every billed run has an entry to correct
  await ensureHiggsfieldCostsSynced();

  const isManager = canManageUsers(actor);
  const scope = dimensionFilter(actor, { provider: query.provider });
  const length = query.to.getTime() - query.from.getTime();

  const [result] = await (await expensesCollection())
    .aggregate([
      { $match: scope },
      {
        $facet: {
          total: totalStages({ incurredAt: { $gte: query.from, $lt: query.to } }),
          previous: totalStages({
            incurredAt: { $gte: new Date(query.from.getTime() - length), $lt: query.from },
          }),
          monthToDate: totalStages({ incurredAt: { $gte: query.monthStart } }),
          days: [
            { $match: { incurredAt: { $gte: query.from, $lt: query.to } } },
            {
              $group: {
                _id: {
                  day: {
                    $dateToString: { format: "%Y-%m-%d", date: "$incurredAt", timezone: query.timeZone },
                  },
                  // Older entries have no provider: Replicate's
                  provider: { $ifNull: ["$provider", "replicate"] },
                },
                amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } },
                runs: { $sum: 1 },
              },
            },
          ],
          byProvider: [
            { $match: { incurredAt: { $gte: query.from, $lt: query.to } } },
            {
              $group: {
                _id: { $ifNull: ["$provider", "replicate"] },
                amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } },
                count: { $sum: 1 },
                unpriced: { $sum: { $cond: [{ $eq: ["$amountUsd", null] }, 1, 0] } },
              },
            },
          ],
          byModel: [
            { $match: { incurredAt: { $gte: query.from, $lt: query.to } } },
            {
              $group: {
                _id: "$model",
                provider: { $first: { $ifNull: ["$provider", "replicate"] } },
                amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } },
                runs: { $sum: 1 },
                unpriced: { $sum: { $cond: [{ $eq: ["$amountUsd", null] }, 1, 0] } },
                averageUsd: { $avg: "$amountUsd" },
                maxUsd: { $max: "$amountUsd" },
              },
            },
            { $sort: { amountUsd: -1, _id: 1 } },
          ],
          byProject: [
            { $match: { incurredAt: { $gte: query.from, $lt: query.to } } },
            ...groupStages("projectId", "projectName"),
          ],
          ...(isManager
            ? {
                byUser: [
                  { $match: { incurredAt: { $gte: query.from, $lt: query.to } } },
                  ...groupStages("userId", "userName"),
                ],
              }
            : {}),
          topRuns: [
            { $match: { incurredAt: { $gte: query.from, $lt: query.to }, amountUsd: { $gt: 0 } } },
            { $sort: { amountUsd: -1, incurredAt: -1 } },
            { $limit: TOP_RUNS },
          ],
        },
      },
    ])
    .toArray();

  // Days: one row per day that had spend, both platforms
  const dayMap = new Map<string, DaySpend>();
  for (const row of (result?.days ?? []) as {
    _id: { day: string; provider: Provider };
    amountUsd: number;
    runs: number;
  }[]) {
    const day = dayMap.get(row._id.day) ?? { day: row._id.day, replicate: 0, higgsfield: 0, elevenlabs: 0, runs: 0 };
    const provider = row._id.provider in day ? row._id.provider : "replicate";
    day[provider] += row.amountUsd;
    day.runs += row.runs;
    dayMap.set(row._id.day, day);
  }

  const providerRows = (result?.byProvider ?? []) as ({ _id: Provider } & SpendTotal)[];
  const providerTotal = (provider: Provider) => readTotal(providerRows.filter((row) => row._id === provider));

  const byProject = readGroups(result?.byProject);
  const byUser = readGroups(result?.byUser);
  const topRows = (result?.topRuns ?? []) as ExpenseDoc[];

  const [outcomes, names] = await Promise.all([
    runOutcomes(actor, query),
    currentNames(
      [...byProject.map((group) => group.id), ...topRows.map((row) => row.projectId)],
      [...byUser.map((group) => group.id), ...topRows.map((row) => row.userId)]
    ),
  ]);

  const rename = (groups: SpendGroup[], map: Map<string, string>) =>
    groups
      .map((group) => ({ ...group, name: map.get(group.id) ?? group.name }))
      .sort((a, b) => b.amountUsd - a.amountUsd || a.name.localeCompare(b.name));

  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    total: readTotal(result?.total),
    previous: readTotal(result?.previous),
    monthToDate: readTotal(result?.monthToDate),
    days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byProvider: {
      replicate: providerTotal("replicate"),
      higgsfield: providerTotal("higgsfield"),
      elevenlabs: providerTotal("elevenlabs"),
    },
    byModel: ((result?.byModel ?? []) as {
      _id: string;
      provider: Provider;
      amountUsd: number;
      runs: number;
      unpriced: number;
      averageUsd: number | null;
      maxUsd: number | null;
    }[]).map((row) => ({
      model: row._id,
      provider: row.provider,
      runs: row.runs,
      amountUsd: row.amountUsd,
      unpriced: row.unpriced,
      averageUsd: row.averageUsd ?? null,
      maxUsd: row.maxUsd ?? null,
    })),
    byProject: rename(byProject, names.projects),
    byUser: rename(byUser, names.users),
    topRuns: topRows.map((row) => ({
      id: row._id,
      model: row.model,
      provider: row.provider ?? "replicate",
      project: names.projects.get(row.projectId) ?? row.projectName,
      user: names.users.get(row.userId) ?? row.userName,
      amountUsd: row.amountUsd ?? 0,
      incurredAt: row.incurredAt.toISOString(),
    })),
    outcomes,
  };
}

// Runs started in the period, by how they ended. Same
// people as the spend; hidden runs for the super admin
// only.
async function runOutcomes(
  actor: StoredUser,
  query: AnalyticsQuery
): Promise<CostAnalytics["outcomes"]> {
  const filter: Filter<GenerationDoc> = {
    createdAt: { $gte: query.from, $lt: query.to },
    ...(canManageUsers(actor) ? {} : { userId: actor.id }),
    ...(canHideGenerations(actor) ? {} : { hiddenAt: null }),
    ...(query.provider ? providerMatch(query.provider) : {}),
  };

  const rows = await (await generationsCollection())
    .aggregate<{ _id: string; count: number }>([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ])
    .toArray();

  const count = (statuses: string[]) =>
    rows.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.count, 0);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const succeeded = count(["succeeded"]);
  const failed = count(["failed", "canceled", "unknown"]);

  return { total, succeeded, failed, running: total - succeeded - failed };
}

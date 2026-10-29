import {
  expensesCollection,
  generationsCollection,
} from "@/lib/db/mongodb";
import {
  higgsfieldBilledUsage,
  higgsfieldConfigured,
  type HiggsfieldBilledUsage,
} from "@/lib/higgsfield/client";

// --------------------------------------------------
// HIGGSFIELD BILLED COSTS
//
// A Higgsfield run is recorded at our estimate (quote,
// or the metered formula). Higgsfield's usage analytics
// later say what was actually charged, per model and
// hour. Where an hour has exactly as many runs of a
// model as we recorded, those runs take the billed cost
// (several are split in proportion to their estimates),
// in both the generation and its expense entry. Hours
// that don't match (runs made outside the app, or not
// reported yet) keep the estimate and are tried again.
// --------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
// Under the API's 31-day limit
const WINDOW_MS = 30 * 24 * HOUR_MS;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

export type HiggsfieldRun = {
  _id: string;
  model: string;
  createdAt: Date;
  costUsd: number | null;
  costSource?: "billed";
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const hourKey = (date: Date, model: string) =>
  `${Math.floor(date.getTime() / HOUR_MS)}|${model}`;

// Billed cost per run id, for the runs whose hour and
// model match Higgsfield's usage exactly
export function billedCosts(
  runs: HiggsfieldRun[],
  usage: HiggsfieldBilledUsage[]
): Map<string, number> {
  const billed = new Map<string, { quantity: number; costUsd: number }>();

  for (const row of usage) {
    const key = hourKey(row.hour, row.model);
    const total = billed.get(key) ?? { quantity: 0, costUsd: 0 };
    billed.set(key, {
      quantity: total.quantity + row.quantity,
      costUsd: total.costUsd + row.costUsd,
    });
  }

  const groups = new Map<string, HiggsfieldRun[]>();

  for (const run of runs) {
    const key = hourKey(run.createdAt, run.model);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const costs = new Map<string, number>();

  for (const [key, group] of groups) {
    const total = billed.get(key);
    if (!total || total.quantity !== group.length) continue;

    const estimates = group.map((run) => run.costUsd);
    const estimated = estimates.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
    const proportional = estimated > 0 && estimates.every((cost) => cost !== null);

    group.forEach((run, index) => {
      const share = proportional ? estimates[index]! / estimated : 1 / group.length;
      costs.set(run._id, round4(total.costUsd * share));
    });
  }

  return costs;
}

// Returns how many runs were updated
export async function syncHiggsfieldBilledCosts(now = new Date()): Promise<number> {
  if (!higgsfieldConfigured()) return 0;

  const generations = await generationsCollection();
  const runs = (await generations
    .find({
      provider: "higgsfield",
      status: "succeeded",
      createdAt: { $gte: new Date(now.getTime() - WINDOW_MS) },
    })
    .project({ model: 1, createdAt: 1, costUsd: 1, costSource: 1 })
    .toArray()) as HiggsfieldRun[];

  const unbilled = runs.filter((run) => run.costSource !== "billed");
  if (!unbilled.length) return 0;

  // Whole hours: Higgsfield snaps the range to them, so
  // ending at "now" would leave out the current hour
  const earliest = Math.min(...unbilled.map((run) => run.createdAt.getTime()));
  const start = new Date(Math.floor(earliest / HOUR_MS) * HOUR_MS);
  const end = new Date(Math.ceil((now.getTime() + 1) / HOUR_MS) * HOUR_MS);
  const usage = await higgsfieldBilledUsage(start, end);

  const costs = billedCosts(
    runs.filter((run) => run.createdAt >= start),
    usage
  );
  const expenses = await expensesCollection();
  let updated = 0;

  for (const run of runs) {
    const cost = costs.get(run._id);
    if (cost === undefined || (run.costSource === "billed" && run.costUsd === cost)) continue;

    await generations.updateOne(
      { _id: run._id },
      { $set: { costUsd: cost, costSource: "billed" } }
    );
    // No entry yet: the ledger backfill copies costUsd
    await expenses.updateOne(
      { _id: run._id },
      { $set: { amountUsd: cost, pricingSource: "billed" } }
    );
    updated++;
  }

  return updated;
}

// At most every few minutes per server process; a
// failure is logged and the estimates stay
const globalForSync = globalThis as unknown as {
  higgsfieldCostSync?: { at: number; promise: Promise<void> };
};

export function ensureHiggsfieldCostsSynced(): Promise<void> {
  const last = globalForSync.higgsfieldCostSync;
  if (last && Date.now() - last.at < SYNC_INTERVAL_MS) return last.promise;

  const promise = syncHiggsfieldBilledCosts()
    .then(() => undefined)
    .catch((error) => {
      console.error(
        "Higgsfield billed cost sync failed:",
        error instanceof Error ? error.message : error
      );
    });

  globalForSync.higgsfieldCostSync = { at: Date.now(), promise };
  return promise;
}

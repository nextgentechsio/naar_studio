import type { Collection } from "mongodb";
import { listUsers } from "@/lib/auth/users";
import { canManageUsers } from "@/lib/auth/roles";
import { expensesCollection, generationsCollection, getDb, projectsCollection } from "@/lib/db/mongodb";
import { sendNotification } from "@/lib/notifications";
import { estimateInFlightUsd } from "@/lib/api-keys/spend";
import { monthKey, monthRange } from "@/lib/api-keys/shared";
import {
  type BudgetKind,
  budgetRefusal,
  parseBudgetUsd,
  type ProjectBudget,
  type ProjectBudgetUsage,
  type PublicProjectBudget,
  usd,
  WARNING_SHARE,
} from "./shared";

// --------------------------------------------------
// PROJECT BUDGETS (MongoDB "projectBudgets", one doc per
// project that has a budget; own collection, set up here)
//
// Spend is the expense ledger (one entry per succeeded
// run) by project. Runs still going count at their
// expected price, so several started together can't all
// slip past the budget. Checked before every run starts
// (Replicate, Higgsfield, ElevenLabs, Catalogue; the
// website and the API alike); alerts at 80% and 100% are
// checked whenever a run's cost is recorded.
// --------------------------------------------------

type AlertMarks = { forUsd: number; at80: boolean; at100: boolean };

type ProjectBudgetDoc = ProjectBudget & {
  // The project id
  _id: string;
  // Which alerts went out, for which budget amount (and
  // month): changing the amount sends them again
  alerts?: {
    total?: AlertMarks;
    monthly?: AlertMarks & { month: string };
  };
  updatedBy: string;
  updatedAt: Date;
};

// Runs older than this that never finished are treated
// as lost, so a stuck run can't block a project forever
const IN_FLIGHT_WINDOW_MS = 6 * 60 * 60 * 1000;
const TERMINAL = ["succeeded", "failed", "canceled"];

async function budgets(): Promise<Collection<ProjectBudgetDoc>> {
  return (await getDb()).collection<ProjectBudgetDoc>("projectBudgets");
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

// --------------------------------------------------
// SPEND
// --------------------------------------------------

export async function projectUsage(projectIds: string[], now = new Date()): Promise<Map<string, ProjectBudgetUsage>> {
  const month = monthKey(now);
  const { from, to } = monthRange(month);

  const [billed, running] = await Promise.all([
    (await expensesCollection())
      .aggregate<{ _id: string; total: number; month: number }>([
        { $match: { projectId: { $in: projectIds } } },
        {
          $group: {
            _id: "$projectId",
            total: { $sum: { $ifNull: ["$amountUsd", 0] } },
            month: {
              $sum: {
                $cond: [
                  { $and: [{ $gte: ["$incurredAt", from] }, { $lt: ["$incurredAt", to] }] },
                  { $ifNull: ["$amountUsd", 0] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray(),
    (await generationsCollection())
      .find(
        {
          projectId: { $in: projectIds },
          createdAt: { $gte: new Date(now.getTime() - IN_FLIGHT_WINDOW_MS) },
          status: { $nin: TERMINAL },
        },
        { projection: { projectId: 1, provider: 1, model: 1, inputs: 1, quotedCostUsd: 1 } }
      )
      .toArray(),
  ]);

  const byProject = new Map(billed.map((row) => [row._id, row]));
  const inFlight = new Map<string, { count: number; usd: number }>();
  for (const run of running) {
    const current = inFlight.get(run.projectId) ?? { count: 0, usd: 0 };
    current.count += 1;
    current.usd += estimateInFlightUsd(run);
    inFlight.set(run.projectId, current);
  }

  return new Map(
    projectIds.map((id) => [
      id,
      {
        month,
        totalSpentUsd: round(byProject.get(id)?.total ?? 0),
        monthSpentUsd: round(byProject.get(id)?.month ?? 0),
        inFlightUsd: round(inFlight.get(id)?.usd ?? 0),
        inFlight: inFlight.get(id)?.count ?? 0,
      },
    ])
  );
}

// --------------------------------------------------
// READ AND SET (admins; the routes check who may)
// --------------------------------------------------

function toPublic(doc: ProjectBudgetDoc | null, projectId: string, usage: ProjectBudgetUsage): PublicProjectBudget {
  return {
    projectId,
    totalUsd: doc?.totalUsd ?? null,
    monthlyUsd: doc?.monthlyUsd ?? null,
    usage,
    updatedAt: doc?.updatedAt.toISOString() ?? null,
  };
}

// Every project's budget and spend (projects without a
// budget too: the page shows what they've spent)
export async function listProjectBudgets(projectIds: string[]): Promise<PublicProjectBudget[]> {
  const [docs, usage] = await Promise.all([
    (await budgets()).find({ _id: { $in: projectIds } }).toArray(),
    projectUsage(projectIds),
  ]);
  const byId = new Map(docs.map((doc) => [doc._id, doc]));
  return projectIds.map((id) => toPublic(byId.get(id) ?? null, id, usage.get(id)!));
}

export type SetBudgetResult = { ok: true; budget: PublicProjectBudget } | { ok: false; status: number; error: string };

export async function setProjectBudget(
  projectId: string,
  input: { totalUsd?: unknown; monthlyUsd?: unknown },
  actorId: string
): Promise<SetBudgetResult> {
  const project = await (await projectsCollection()).findOne({ _id: projectId }, { projection: { _id: 1 } });
  if (!project) return { ok: false, status: 404, error: "Project not found" };

  // A field left out keeps its amount
  const collection = await budgets();
  const existing = await collection.findOne({ _id: projectId });
  const totalUsd = input.totalUsd === undefined ? (existing?.totalUsd ?? null) : parseBudgetUsd(input.totalUsd);
  const monthlyUsd = input.monthlyUsd === undefined ? (existing?.monthlyUsd ?? null) : parseBudgetUsd(input.monthlyUsd);
  if (totalUsd === undefined || monthlyUsd === undefined) {
    return { ok: false, status: 400, error: "A budget must be an amount in dollars above $0 (or empty for none)" };
  }

  if (totalUsd === null && monthlyUsd === null) {
    await collection.deleteOne({ _id: projectId });
  } else {
    await collection.updateOne(
      { _id: projectId },
      { $set: { totalUsd, monthlyUsd, updatedBy: actorId, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  const doc = await collection.findOne({ _id: projectId });
  const usage = (await projectUsage([projectId])).get(projectId)!;
  // A lower budget may already be past 80% or 100%
  void checkProjectBudgetAlerts(projectId).catch(() => undefined);
  return { ok: true, budget: toPublic(doc, projectId, usage) };
}

// --------------------------------------------------
// BEFORE A RUN STARTS
//
// runUsd: the run's expected price when known (a promise
// is only waited for when the project has a budget, so
// projects without one start as fast as before).
// --------------------------------------------------

export type BudgetCheck = { ok: true } | { ok: false; status: 402; error: string; code: "project_budget_reached" };

export async function checkProjectBudget(
  project: { id: string; name: string },
  runUsd: number | null | Promise<number | null> = null
): Promise<BudgetCheck> {
  const doc = await (await budgets()).findOne({ _id: project.id });
  if (!doc || (doc.totalUsd === null && doc.monthlyUsd === null)) return { ok: true };

  const [usage, price] = await Promise.all([
    projectUsage([project.id]).then((map) => map.get(project.id)!),
    Promise.resolve(runUsd).catch(() => null),
  ]);
  const refusal = budgetRefusal(project.name, doc, usage, price ?? 0);
  if (!refusal) return { ok: true };

  void checkProjectBudgetAlerts(project.id).catch(() => undefined);
  return { ok: false, status: 402, error: refusal.message, code: "project_budget_reached" };
}

// --------------------------------------------------
// ALERTS AT 80% AND 100%
//
// Of billed spend, once per budget amount (and month, for
// the monthly one). To the admins and everyone who has
// run something in the project, as a notification in the
// bell (and its pop-up).
// --------------------------------------------------

const SENDER = { id: "system:budgets", name: "Naar Studio", role: "user" as const };

export async function checkProjectBudgetAlerts(projectId: string, now = new Date()): Promise<void> {
  const collection = await budgets();
  const doc = await collection.findOne({ _id: projectId });
  if (!doc) return;

  const usage = (await projectUsage([projectId], now)).get(projectId)!;
  const due: { kind: BudgetKind; level: "at80" | "at100"; limit: number; spent: number }[] = [];

  for (const kind of ["total", "monthly"] as const) {
    const limit = kind === "total" ? doc.totalUsd : doc.monthlyUsd;
    if (limit === null) continue;
    const spent = kind === "total" ? usage.totalSpentUsd : usage.monthSpentUsd;
    const share = spent / limit;
    const level = share >= 1 ? "at100" : share >= WARNING_SHARE ? "at80" : null;
    if (!level) continue;

    // Already sent for this amount (and month)?
    const marks = doc.alerts?.[kind];
    const current =
      marks && marks.forUsd === limit && (kind === "total" || (marks as { month?: string }).month === usage.month)
        ? marks
        : null;
    if (current?.[level]) continue;

    // Claim it first, so two finishing runs send one
    const next = {
      forUsd: limit,
      at80: true,
      at100: level === "at100",
      ...(kind === "monthly" ? { month: usage.month } : {}),
    };
    const field = `alerts.${kind}`;
    const claim = await collection.updateOne(
      {
        _id: projectId,
        $or: [
          { [`${field}.forUsd`]: { $ne: limit } },
          ...(kind === "monthly" ? [{ [`${field}.month`]: { $ne: usage.month } }] : []),
          { [`${field}.${level}`]: { $ne: true } },
        ],
      },
      { $set: { [field]: next } }
    );
    if (claim.modifiedCount) due.push({ kind, level, limit, spent });
  }

  if (!due.length) return;

  const project = await (await projectsCollection()).findOne({ _id: projectId }, { projection: { name: 1 } });
  if (!project) return;
  const recipients = await budgetRecipients(projectId);
  if (!recipients.length) return;

  for (const alert of due) {
    const label = alert.kind === "total" ? "total budget" : "monthly budget";
    const amount = `${usd(alert.spent)} of ${usd(alert.limit)}`;
    const reached = alert.level === "at100";
    try {
      await sendNotification(SENDER, {
        title: reached
          ? `"${project.name}" reached its ${label}`
          : `"${project.name}" has used ${Math.floor((alert.spent / alert.limit) * 100)}% of its ${label}`,
        body: reached
          ? `${amount} spent${alert.kind === "monthly" ? " this month" : ""}. New runs in this project are refused until an admin raises the budget${alert.kind === "monthly" ? " or the month ends" : ""}.`
          : `${amount} spent${alert.kind === "monthly" ? " this month" : ""}. New runs are refused once the budget is reached.`,
        level: reached ? "important" : "info",
        recipients,
      });
    } catch (error) {
      console.error("Project budget alert failed:", projectId, error);
    }
  }
}

// The admins, and everyone who has run something in the
// project (users that still exist)
async function budgetRecipients(projectId: string): Promise<string[]> {
  const [users, workers] = await Promise.all([
    listUsers(),
    (await generationsCollection()).distinct("userId", { projectId }),
  ]);
  const inProject = new Set(workers.map(String));
  return users.filter((user) => canManageUsers(user) || inProject.has(user.id)).map((user) => user.id);
}

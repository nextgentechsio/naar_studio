import type { Filter } from "mongodb";
import {
  expensesCollection,
  generationsCollection,
  type ExpenseDoc,
  type GenerationDoc,
  isProvider,
  providerMatch,
  type Provider,
} from "@/lib/mongodb";
import { canManageUsers } from "@/lib/roles";
import { currentNames } from "@/lib/names";
import type { StoredUser } from "@/lib/users";

// --------------------------------------------------
// EXPENSE LEDGER (MongoDB "expenses")
//
// One entry per succeeded generation, written by the
// server when the generation completes. Entries are
// keyed by generation id and only ever inserted, so a
// generation is billed at most once. Totals are
// aggregated in MongoDB, not in the browser.
// --------------------------------------------------

export type PublicExpense = {
  id: string;
  generationId: string;
  userId: string;
  user: string;
  projectId: string;
  project: string;
  model: string;
  amountUsd: number | null;
  incurredAt: string;
};

export type SpendTotal = {
  amountUsd: number;
  count: number;
  // Entries whose model has no known price
  unpriced: number;
};

export type SpendGroup = SpendTotal & {
  id: string;
  name: string;
};

export type ExpenseReport = {
  totals: {
    today: SpendTotal;
    week: SpendTotal;
    month: SpendTotal;
    allTime: SpendTotal;
    // Everything the filters (date range included) match
    selected: SpendTotal;
  };
  byProject: SpendGroup[];
  byUser: SpendGroup[];
  // For the filter dropdowns: what the viewer may see
  options: {
    projects: { id: string; name: string }[];
    users: { id: string; name: string }[];
    models: string[];
  };
} & ExpensePage;

// One page of ledger entries, newest first. Pass
// nextCursor back for the following page; null at the end.
export type ExpensePage = {
  entries: PublicExpense[];
  nextCursor: string | null;
};

export const EXPENSE_PAGE_SIZE = 50;
export const EXPENSE_MAX_PAGE_SIZE = 100;

function toPublicExpense(doc: ExpenseDoc): PublicExpense {
  return {
    id: doc._id,
    generationId: doc.generationId,
    userId: doc.userId,
    user: doc.userName,
    projectId: doc.projectId,
    project: doc.projectName,
    model: doc.model,
    amountUsd: doc.amountUsd,
    incurredAt: doc.incurredAt.toISOString(),
  };
}

// --------------------------------------------------
// WRITE
// --------------------------------------------------

export async function recordExpense(
  generation: GenerationDoc,
  amountUsd: number | null,
  incurredAt: Date
) {
  const entry: ExpenseDoc = {
    _id: generation._id,
    generationId: generation._id,
    userId: generation.userId,
    userName: generation.userName,
    projectId: generation.projectId,
    projectName: generation.projectName,
    provider: generation.provider ?? "replicate",
    model: generation.model,
    amountUsd,
    currency: "USD",
    pricingSource: "estimated",
    incurredAt,
    createdAt: new Date(),
  };

  // Insert-only: an existing entry is never changed
  await (await expensesCollection()).updateOne(
    { _id: entry._id },
    { $setOnInsert: entry },
    { upsert: true }
  );
}

// Adds ledger entries for succeeded generations that
// don't have one yet (e.g. completed before the ledger
// existed). Runs once per server process, server-side.
const globalForBackfill = globalThis as unknown as {
  expenseBackfillPromise?: Promise<void>;
};

async function backfillExpenses() {
  await (await generationsCollection())
    .aggregate([
      { $match: { status: "succeeded" } },
      {
        $project: {
          _id: 1,
          generationId: "$_id",
          userId: 1,
          userName: 1,
          projectId: 1,
          projectName: 1,
          provider: 1,
          model: 1,
          amountUsd: { $ifNull: ["$costUsd", null] },
          currency: { $literal: "USD" },
          pricingSource: { $literal: "estimated" },
          incurredAt: {
            $ifNull: ["$completedAt", "$createdAt"],
          },
          createdAt: "$$NOW",
        },
      },
      {
        $merge: {
          into: "expenses",
          on: "_id",
          whenMatched: "keepExisting",
          whenNotMatched: "insert",
        },
      },
    ])
    .toArray();
}

export async function ensureBackfilled() {
  if (!globalForBackfill.expenseBackfillPromise) {
    globalForBackfill.expenseBackfillPromise =
      backfillExpenses().catch((error) => {
        globalForBackfill.expenseBackfillPromise = undefined;
        throw error;
      });
  }

  await globalForBackfill.expenseBackfillPromise;
}

// --------------------------------------------------
// READ
// --------------------------------------------------

export function totalStages(match?: Record<string, unknown>) {
  return [
    ...(match ? [{ $match: match }] : []),
    {
      $group: {
        _id: null,
        amountUsd: {
          $sum: { $ifNull: ["$amountUsd", 0] },
        },
        count: { $sum: 1 },
        unpriced: {
          $sum: {
            $cond: [{ $eq: ["$amountUsd", null] }, 1, 0],
          },
        },
      },
    },
  ];
}

export function groupStages(idField: string, nameField: string) {
  return [
    {
      $group: {
        _id: `$${idField}`,
        name: { $last: `$${nameField}` },
        amountUsd: {
          $sum: { $ifNull: ["$amountUsd", 0] },
        },
        count: { $sum: 1 },
        unpriced: {
          $sum: {
            $cond: [{ $eq: ["$amountUsd", null] }, 1, 0],
          },
        },
      },
    },
    { $sort: { amountUsd: -1 as const, name: 1 as const } },
  ];
}

const EMPTY_TOTAL: SpendTotal = {
  amountUsd: 0,
  count: 0,
  unpriced: 0,
};

export function readTotal(rows: unknown): SpendTotal {
  const row = (rows as SpendTotal[] | undefined)?.[0];

  return row
    ? {
        amountUsd: row.amountUsd,
        count: row.count,
        unpriced: row.unpriced,
      }
    : EMPTY_TOTAL;
}

export function readGroups(rows: unknown): SpendGroup[] {
  return (
    (rows as (SpendTotal & {
      _id: string;
      name: string;
    })[]) ?? []
  ).map((row) => ({
    id: row._id,
    name: row.name,
    amountUsd: row.amountUsd,
    count: row.count,
    unpriced: row.unpriced,
  }));
}

// Narrows the report and the entries. The user filter
// only applies to managers (others only see their own).
// from/to are instants (the browser sends its local
// midnights); to is exclusive.
export type ExpenseFilters = {
  projectId?: string;
  userId?: string;
  model?: string;
  provider?: Provider;
  from?: Date;
  to?: Date;
};

// From a request's query: ?project=&user=&model=&provider=&from=&to=
// (from/to as ISO instants). Anything malformed is left
// out rather than refused.
export function readExpenseFilters(params: URLSearchParams): ExpenseFilters {
  const id = (key: string) => {
    const value = params.get(key)?.trim();
    return value && value.length <= 200 ? value : undefined;
  };

  const date = (key: string) => {
    const value = params.get(key);
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  };

  return {
    projectId: id("project"),
    userId: id("user"),
    model: id("model"),
    provider: isProvider(params.get("provider")) ? (params.get("provider") as Provider) : undefined,
    from: date("from"),
    to: date("to"),
  };
}

// What the viewer may see, narrowed by everything but
// the date range
export function dimensionFilter(
  actor: StoredUser,
  filters: ExpenseFilters
): Filter<ExpenseDoc> {
  const isManager = canManageUsers(actor);

  // Plain users only ever see their own spend
  const filter: Filter<ExpenseDoc> = isManager ? {} : { userId: actor.id };

  if (filters.projectId) filter.projectId = filters.projectId;
  if (filters.userId && isManager) filter.userId = filters.userId;
  if (filters.model) filter.model = filters.model;
  if (filters.provider) Object.assign(filter, providerMatch(filters.provider));

  return filter;
}

function dateFilter(filters: ExpenseFilters): Filter<ExpenseDoc> {
  if (!filters.from && !filters.to) return {};

  return {
    incurredAt: {
      ...(filters.from && { $gte: filters.from }),
      ...(filters.to && { $lt: filters.to }),
    },
  };
}

// Period starts come from the browser so "today" and
// "this week" follow the viewer's local timezone.
//
// The period totals follow the project/user/model
// filters but not the date range; "selected", the
// groups and the entries follow all of them. The filter
// dropdown values cover everything the viewer may see.
export async function getExpenseReport(
  actor: StoredUser,
  periods: { todayStart: Date; weekStart: Date; monthStart: Date },
  // 0 leaves the entries out (the dashboard only needs
  // the totals)
  entryLimit = EXPENSE_PAGE_SIZE,
  filters: ExpenseFilters = {}
): Promise<ExpenseReport> {
  await ensureBackfilled();

  const isManager = canManageUsers(actor);
  const scope = dimensionFilter(actor, {});
  const dimensions = dimensionFilter(actor, filters);
  const dates = dateFilter(filters);

  const expenses = await expensesCollection();

  // One pass over the viewer's entries
  const [result] = await expenses
    .aggregate([
      { $match: scope },
      {
        $facet: {
          today: totalStages({
            ...dimensions,
            incurredAt: { $gte: periods.todayStart },
          }),
          week: totalStages({
            ...dimensions,
            incurredAt: { $gte: periods.weekStart },
          }),
          month: totalStages({
            ...dimensions,
            incurredAt: { $gte: periods.monthStart },
          }),
          allTime: totalStages(dimensions),
          selected: totalStages({ ...dimensions, ...dates }),
          byProject: [
            { $match: { ...dimensions, ...dates } },
            ...groupStages("projectId", "projectName"),
          ],
          // Per-user breakdown is for managers only
          ...(isManager
            ? {
                byUser: [
                  { $match: { ...dimensions, ...dates } },
                  ...groupStages("userId", "userName"),
                ],
              }
            : {}),
          optionProjects: optionStages("projectId", "projectName"),
          optionModels: [{ $group: { _id: "$model" } }],
          ...(isManager
            ? { optionUsers: optionStages("userId", "userName") }
            : {}),
        },
      },
    ])
    .toArray();

  const byProject = readGroups(result?.byProject);
  const byUser = readGroups(result?.byUser);
  const optionProjects = readOptions(result?.optionProjects);
  const optionUsers = readOptions(result?.optionUsers);

  const [page, names] = await Promise.all([
    entryLimit > 0
      ? listExpenses(actor, { limit: entryLimit, filters })
      : { entries: [], nextCursor: null },
    // Show today's names after a rename
    currentNames(
      [...byProject, ...optionProjects].map((group) => group.id),
      [...byUser, ...optionUsers].map((group) => group.id)
    ),
  ]);

  const rename = <T extends { id: string; name: string }>(
    groups: T[],
    map: Map<string, string>
  ) => groups.map((group) => ({ ...group, name: map.get(group.id) ?? group.name }));

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  return {
    totals: {
      today: readTotal(result?.today),
      week: readTotal(result?.week),
      month: readTotal(result?.month),
      allTime: readTotal(result?.allTime),
      selected: readTotal(result?.selected),
    },
    byProject: rename(byProject, names.projects),
    byUser: rename(byUser, names.users),
    options: {
      projects: rename(optionProjects, names.projects).sort(byName),
      users: rename(optionUsers, names.users).sort(byName),
      models: ((result?.optionModels ?? []) as { _id: string }[])
        .map((row) => row._id)
        .filter(Boolean)
        .sort(),
    },
    ...page,
  };
}

// Distinct ids with their latest name
function optionStages(idField: string, nameField: string) {
  return [
    { $sort: { incurredAt: 1 as const } },
    { $group: { _id: `$${idField}`, name: { $last: `$${nameField}` } } },
  ];
}

function readOptions(rows: unknown): { id: string; name: string }[] {
  return ((rows as { _id: string; name: string }[]) ?? [])
    .filter((row) => row._id)
    .map((row) => ({ id: row._id, name: row.name }));
}

// Cursor: the last entry's time and id, so pages never
// overlap or skip even when entries share a timestamp
function encodeCursor(doc: ExpenseDoc): string {
  return `${doc.incurredAt.getTime()}_${doc._id}`;
}

function decodeCursor(cursor: string): { time: Date; id: string } | null {
  const at = cursor.indexOf("_");
  const time = new Date(Number(cursor.slice(0, at)));
  const id = cursor.slice(at + 1);

  return at > 0 && id && !Number.isNaN(time.getTime()) ? { time, id } : null;
}

// One page of entries: after a cursor, or by page number
// (1-based, for numbered pages; the report's "selected"
// count says how many there are)
export async function listExpenses(
  actor: StoredUser,
  options: { limit?: number; cursor?: string; page?: number; filters?: ExpenseFilters } = {}
): Promise<ExpensePage> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit || EXPENSE_PAGE_SIZE)),
    EXPENSE_MAX_PAGE_SIZE
  );

  const filter: Filter<ExpenseDoc> = {
    ...dimensionFilter(actor, options.filters ?? {}),
    ...dateFilter(options.filters ?? {}),
  };

  const after = options.cursor ? decodeCursor(options.cursor) : null;
  if (after) {
    filter.$or = [
      { incurredAt: { $lt: after.time } },
      { incurredAt: after.time, _id: { $lt: after.id } },
    ];
  }

  // Finite and bounded: skip(Infinity) makes Mongo throw
  const page =
    !after && options.page && Number.isFinite(options.page)
      ? Math.min(Math.max(1, Math.floor(options.page)), 100_000)
      : 1;

  // One extra tells whether another page follows
  const docs = await (await expensesCollection())
    .find(filter)
    .sort({ incurredAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .toArray();

  const pageDocs = docs.slice(0, limit);
  const entries = pageDocs.map(toPublicExpense);

  // Show today's names after a rename
  const names = await currentNames(
    entries.map((entry) => entry.projectId),
    entries.map((entry) => entry.userId)
  );

  for (const entry of entries) {
    entry.project = names.projects.get(entry.projectId) ?? entry.project;
    entry.user = names.users.get(entry.userId) ?? entry.user;
  }

  return {
    entries,
    nextCursor: docs.length > limit ? encodeCursor(pageDocs[limit - 1]) : null,
  };
}

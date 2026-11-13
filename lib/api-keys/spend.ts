import type { ObjectId } from "mongodb";
import { findUserById, listUsers } from "@/lib/auth/users";
import { canManageUsers } from "@/lib/auth/roles";
import { expensesCollection, generationsCollection, type GenerationDoc } from "@/lib/db/mongodb";
import { TERMINAL_STATUSES } from "@/lib/generations";
import { sendNotification } from "@/lib/notifications";
import { elevenLabsCostUsd } from "@/lib/elevenlabs/models";
import { calculateReplicateCost } from "@/lib/replicate/cost";
import { apiKeysCollection, type ApiKeyDoc } from "./db";
import { type ApiKeySpend, capState, monthKey, monthRange } from "./shared";

// --------------------------------------------------
// SPEND PER KEY, AND THE MONTHLY CAP
//
// Billed spend comes from the expense ledger (one entry
// per succeeded run, with the key that started it). Runs
// still in flight count with an estimate: Higgsfield's
// quote when there is one, else our price table from the
// inputs (null when the price depends on the run's
// length: counted, at $0).
// --------------------------------------------------

// What a run that hasn't finished is expected to cost
export function estimateInFlightUsd(run: Pick<GenerationDoc, "provider" | "model" | "inputs" | "quotedCostUsd">): number {
  if (typeof run.quotedCostUsd === "number") return run.quotedCostUsd;
  const provider = run.provider ?? "replicate";
  if (provider === "elevenlabs") return elevenLabsCostUsd(run.model, run.inputs ?? {}) ?? 0;
  if (provider !== "replicate") return 0;
  try {
    // Priced as if it had succeeded: the table's per-run
    // price from the inputs (per-second models stay null)
    return calculateReplicateCost(run.model, { status: "succeeded", input: run.inputs ?? {} }) ?? 0;
  } catch {
    return 0;
  }
}

type Billed = { amountUsd: number; count: number };
type InFlight = { count: number; usd: number };

async function billedByKey(ids: string[], month: string): Promise<Map<string, Billed>> {
  const { from, to } = monthRange(month);
  const rows = await (await expensesCollection())
    .aggregate<{ _id: string; amountUsd: number; count: number }>([
      { $match: { apiKeyId: { $in: ids }, incurredAt: { $gte: from, $lt: to } } },
      { $group: { _id: "$apiKeyId", amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } }, count: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, { amountUsd: row.amountUsd, count: row.count }]));
}

async function inFlightByKey(ids: string[]): Promise<Map<string, InFlight>> {
  const runs = await (await generationsCollection())
    .find(
      { apiKeyId: { $in: ids }, status: { $nin: [...TERMINAL_STATUSES] } },
      { projection: { apiKeyId: 1, provider: 1, model: 1, inputs: 1, quotedCostUsd: 1 } }
    )
    .toArray();
  const map = new Map<string, InFlight>();
  for (const run of runs) {
    const current = map.get(run.apiKeyId!) ?? { count: 0, usd: 0 };
    current.count += 1;
    current.usd += estimateInFlightUsd(run);
    map.set(run.apiKeyId!, current);
  }
  return map;
}

// This month's spend for several keys at once (the admin list)
export async function spendByKey(ids: ObjectId[], month = monthKey()): Promise<Map<string, ApiKeySpend>> {
  const hex = ids.map((id) => id.toHexString());
  const [billed, inFlight] = await Promise.all([billedByKey(hex, month), inFlightByKey(hex)]);
  return new Map(
    hex.map((id) => {
      const b = billed.get(id);
      const f = inFlight.get(id);
      return [
        id,
        {
          month,
          amountUsd: round(b?.amountUsd ?? 0),
          count: b?.count ?? 0,
          inFlight: f?.count ?? 0,
          inFlightUsd: round(f?.usd ?? 0),
        },
      ];
    })
  );
}

export async function keySpend(id: ObjectId, month = monthKey()): Promise<ApiKeySpend> {
  return (await spendByKey([id], month)).get(id.toHexString())!;
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

// Spend by model and by project for one key's month (the
// /usage endpoint)
export async function keySpendBreakdown(id: ObjectId, month: string) {
  const { from, to } = monthRange(month);
  const match = { apiKeyId: id.toHexString(), incurredAt: { $gte: from, $lt: to } };
  const group = (field: string, nameField?: string) =>
    (async () =>
      (
        await (await expensesCollection())
          .aggregate<{ _id: string; name?: string; amountUsd: number; count: number }>([
            { $match: match },
            {
              $group: {
                _id: `$${field}`,
                ...(nameField ? { name: { $last: `$${nameField}` } } : {}),
                amountUsd: { $sum: { $ifNull: ["$amountUsd", 0] } },
                count: { $sum: 1 },
              },
            },
            { $sort: { amountUsd: -1 } },
          ])
          .toArray()
      ).map((row) => ({ id: row._id, name: row.name ?? row._id, amountUsd: round(row.amountUsd), count: row.count })))();

  const [byModel, byProject] = await Promise.all([group("model"), group("projectId", "projectName")]);
  return { byModel, byProject };
}

// --------------------------------------------------
// THE CAP
// --------------------------------------------------

export type CapCheck =
  | { allowed: true; spend: ApiKeySpend }
  | { allowed: false; spend: ApiKeySpend; reason: "cap" | "concurrency" };

// Before a run starts: refused once what's billed plus
// what's in flight reaches the cap, or the key has as
// many runs going as it may
export async function checkRunAllowed(key: ApiKeyDoc): Promise<CapCheck> {
  const spend = await keySpend(key._id);
  if (spend.inFlight >= key.concurrency) return { allowed: false, spend, reason: "concurrency" };
  if (capState(spend, key.monthlyCapUsd) === "reached") return { allowed: false, spend, reason: "cap" };
  return { allowed: true, spend };
}

// --------------------------------------------------
// ALERTS AT 80% AND 100%
//
// Sent once a month each, to the key's owner and every
// admin, the first time billed spend crosses the line.
// Checked whenever the key is used (throttled) and when
// a run is refused for the cap.
// --------------------------------------------------

const lastAlertCheck = new Map<string, number>();
const ALERT_CHECK_MS = 60_000;

export async function checkCapAlerts(key: ApiKeyDoc, spend?: ApiKeySpend, now = Date.now()): Promise<void> {
  if (key.monthlyCapUsd === null) return;
  const id = key._id.toHexString();
  if (!spend && (lastAlertCheck.get(id) ?? 0) > now - ALERT_CHECK_MS) return;
  lastAlertCheck.set(id, now);

  const current = spend ?? (await keySpend(key._id));
  const month = current.month;
  const share = current.amountUsd / key.monthlyCapUsd;
  const level: "at80" | "at100" | null = share >= 1 ? "at100" : share >= 0.8 ? "at80" : null;
  if (!level) return;

  // Claim the alert first, so parallel requests send one
  const alerted = key.alerted?.month === month ? key.alerted : { month, at80: false, at100: false };
  const next = { ...alerted, at80: alerted.at80 || level === "at80" || level === "at100", at100: alerted.at100 || level === "at100" };
  if (next.at80 === alerted.at80 && next.at100 === alerted.at100) return;

  const claim = await (await apiKeysCollection()).updateOne(
    {
      _id: key._id,
      $or: [{ "alerted.month": { $ne: month } }, { [`alerted.${level}`]: { $ne: true } }],
    },
    { $set: { alerted: next } }
  );
  if (!claim.modifiedCount) return;
  key.alerted = next;

  const owner = await findUserById(key.userId);
  if (!owner) return;
  const managers = (await listUsers()).filter((user) => canManageUsers(user)).map((user) => user.id);
  const recipients = [...new Set([owner.id, ...managers])];
  const percent = Math.floor(share * 100);
  const amount = `$${current.amountUsd.toFixed(2)} of $${key.monthlyCapUsd.toFixed(2)}`;

  try {
    await sendNotification(owner, {
      title:
        level === "at100"
          ? `API key "${key.name}" reached its monthly cap`
          : `API key "${key.name}" is at ${percent}% of its monthly cap`,
      body:
        level === "at100"
          ? `${amount} spent this month. New runs with this key are refused until the cap is raised or the month ends.`
          : `${amount} spent this month. Runs are refused at the cap.`,
      level: level === "at100" ? "important" : "info",
      recipients,
    });
  } catch (error) {
    console.error("API key cap alert failed:", id, error);
  }
}

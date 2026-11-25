import { getDb } from "@/lib/db/mongodb";
import { listUsers } from "@/lib/auth/users";

// --------------------------------------------------
// BUDGET MANAGERS (MongoDB "budgetSettings", one doc
// "managers")
//
// The super admin chooses who else may set and change
// project budgets: one or more admins. The super admin
// always can; every other admin sees budgets without
// changing them.
// --------------------------------------------------

type ManagersDoc = {
  _id: "managers";
  userIds: string[];
  updatedBy: string;
  updatedAt: Date;
};

export type BudgetManager = { id: string; name: string; username: string };

async function settings() {
  return (await getDb()).collection<ManagersDoc>("budgetSettings");
}

async function storedIds(): Promise<string[]> {
  return (await (await settings()).findOne({ _id: "managers" }))?.userIds ?? [];
}

// Chosen managers that are still active admins
export async function listBudgetManagers(): Promise<BudgetManager[]> {
  const [ids, users] = await Promise.all([storedIds(), listUsers()]);
  const chosen = new Set(ids);
  return users
    .filter((user) => chosen.has(user.id) && user.role === "admin" && !user.disabled)
    .map((user) => ({ id: user.id, name: user.name, username: user.username }));
}

// The super admin, or a chosen admin
export async function isBudgetManager(user: { id: string; role: string; disabled?: boolean }): Promise<boolean> {
  if (user.disabled) return false;
  if (user.role === "super_admin") return true;
  if (user.role !== "admin") return false;
  return (await storedIds()).includes(user.id);
}

// Who the super admin can choose from: active admins
export async function budgetManagerCandidates(): Promise<BudgetManager[]> {
  return (await listUsers())
    .filter((user) => user.role === "admin" && !user.disabled)
    .map((user) => ({ id: user.id, name: user.name, username: user.username }));
}

export async function setBudgetManagers(
  userIds: unknown,
  actorId: string
): Promise<{ ok: true; managers: BudgetManager[] } | { ok: false; status: number; error: string }> {
  if (!Array.isArray(userIds) || !userIds.every((id) => typeof id === "string")) {
    return { ok: false, status: 400, error: "Choose the budget managers as a list of users" };
  }
  const wanted = [...new Set(userIds as string[])];
  const allowed = new Set((await budgetManagerCandidates()).map((user) => user.id));
  if (wanted.some((id) => !allowed.has(id))) {
    return { ok: false, status: 400, error: "Budget managers must be active admins" };
  }
  await (await settings()).updateOne(
    { _id: "managers" },
    { $set: { userIds: wanted, updatedBy: actorId, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ok: true, managers: await listBudgetManagers() };
}

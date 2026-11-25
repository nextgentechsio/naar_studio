import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { projectsCollection } from "@/lib/db/mongodb";
import { budgetManagerCandidates, isBudgetManager, listBudgetManagers } from "@/lib/project-budgets/managers";
import { listProjectBudgets } from "@/lib/project-budgets/server";

export const runtime = "nodejs";

// --------------------------------------------------
// Every project's budget and what it has spent (the
// Projects page). Admins and the super admin.
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;

  try {
    const ids = (await (await projectsCollection()).find({}, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id);
    const superAdmin = auth.user.role === "super_admin";
    const [budgets, managers, canEdit, candidates] = await Promise.all([
      listProjectBudgets(ids),
      listBudgetManagers(),
      isBudgetManager(auth.user),
      superAdmin ? budgetManagerCandidates() : Promise.resolve(undefined),
    ]);
    return NextResponse.json({
      budgets,
      // Who may change budgets, and whether this viewer may
      managers,
      canEdit,
      // The super admin chooses them, from these
      ...(candidates ? { candidates } : {}),
    });
  } catch (error) {
    console.error("List project budgets error:", error);
    return NextResponse.json({ error: "Failed to load budgets" }, { status: 500 });
  }
}

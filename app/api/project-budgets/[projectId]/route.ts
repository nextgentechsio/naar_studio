import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { isBudgetManager } from "@/lib/project-budgets/managers";
import { setProjectBudget } from "@/lib/project-budgets/server";

export const runtime = "nodejs";

// --------------------------------------------------
// Set a project's budgets: { totalUsd, monthlyUsd }, each
// an amount in dollars, or null for none. Only the
// budget managers the super admin chose.
// --------------------------------------------------

export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const auth = await requireUser(["super_admin", "admin"]);
  if (auth.response) return auth.response;
  if (!(await isBudgetManager(auth.user))) {
    return NextResponse.json(
      { error: "Only the budget manager can set budgets. The super admin chooses who that is." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { projectId } = await context.params;
    const result = await setProjectBudget(projectId, body as Record<string, unknown>, auth.user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ budget: result.budget });
  } catch (error) {
    console.error("Set project budget error:", error);
    return NextResponse.json({ error: "Failed to save the budget" }, { status: 500 });
  }
}

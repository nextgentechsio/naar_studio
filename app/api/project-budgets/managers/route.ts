import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { setBudgetManagers } from "@/lib/project-budgets/managers";

export const runtime = "nodejs";

// --------------------------------------------------
// Choose the budget managers: { userIds: [...] }, active
// admins. The super admin only.
// --------------------------------------------------

export async function PUT(request: Request) {
  const auth = await requireUser(["super_admin"]);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
  try {
    const result = await setBudgetManagers(body?.userIds, auth.user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ managers: result.managers });
  } catch (error) {
    console.error("Set budget managers error:", error);
    return NextResponse.json({ error: "Failed to save the budget managers" }, { status: 500 });
  }
}

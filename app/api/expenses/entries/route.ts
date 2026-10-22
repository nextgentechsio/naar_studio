import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listExpenses, readExpenseFilters } from "@/lib/expenses";

export const runtime = "nodejs";

// More expense entries, newest first, for "Load more".
// ?cursor=<nextCursor from the previous page>&limit=50,
// plus the same filters as /api/expenses
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const params = new URL(request.url).searchParams;

    return NextResponse.json(
      await listExpenses(auth.user, {
        cursor: params.get("cursor") || undefined,
        limit: Number(params.get("limit")) || undefined,
        filters: readExpenseFilters(params),
      })
    );
  } catch (error) {
    console.error("List expenses error:", error);

    return NextResponse.json(
      { error: "Failed to load expenses" },
      { status: 500 }
    );
  }
}

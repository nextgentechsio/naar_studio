import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { duplicateBoard } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST: a copy of the board and everything on it
export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const result = await duplicateBoard(auth.user, (await context.params).id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ board: result.value }, { status: 201 });
  } catch (error) {
    console.error("Duplicate board error:", error);
    return NextResponse.json({ error: "Couldn't duplicate the board" }, { status: 500 });
  }
}

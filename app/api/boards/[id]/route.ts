import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteBoard, getBoard, renameBoard } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// GET: the board and every item on it. PATCH { name }: rename. DELETE: the board, its items and files.
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const result = await getBoard(auth.user, (await context.params).id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value);
  } catch (error) {
    console.error("Get board error:", error);
    return NextResponse.json({ error: "Couldn't open the board" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const result = await renameBoard(auth.user, (await context.params).id, body?.name);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ board: result.value });
  } catch (error) {
    console.error("Rename board error:", error);
    return NextResponse.json({ error: "Couldn't rename the board" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const result = await deleteBoard(auth.user, (await context.params).id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete board error:", error);
    return NextResponse.json({ error: "Couldn't delete the board" }, { status: 500 });
  }
}

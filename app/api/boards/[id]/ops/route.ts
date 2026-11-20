import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { saveOps } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 1_000_000;

// POST { ops: BoardOp[] }: save a batch of changes, in order
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too many changes at once" }, { status: 413 });
    const body = JSON.parse(text || "{}") as { ops?: unknown };
    const result = await saveOps(auth.user, (await context.params).id, body.ops);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    console.error("Save board error:", error);
    return NextResponse.json({ error: "Couldn't save the board" }, { status: 500 });
  }
}

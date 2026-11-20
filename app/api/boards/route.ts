import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createBoard, listBoards } from "@/lib/boards/server";

export const runtime = "nodejs";

// GET: the user's boards, newest first (?scope=all: everyone's, for the super admin). POST { name }: a new board.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "mine";
    return NextResponse.json({ boards: await listBoards(auth.user, scope) });
  } catch (error) {
    console.error("List boards error:", error);
    return NextResponse.json({ error: "Couldn't load your boards" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const result = await createBoard(auth.user, body?.name);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ board: result.value }, { status: 201 });
  } catch (error) {
    console.error("Create board error:", error);
    return NextResponse.json({ error: "Couldn't create the board" }, { status: 500 });
  }
}

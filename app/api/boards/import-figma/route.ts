import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { importFigmaBoard } from "@/lib/boards/server";

export const runtime = "nodejs";
// A big board means many pictures to copy
export const maxDuration = 300;

// POST { url }: a new board from a FigJam or Figma link,
// read with the studio's read-only Figma token
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send { url }" }, { status: 400 });
  }

  try {
    const result = await importFigmaBoard(auth.user, body?.url);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    console.error("Figma import error:", error);
    return NextResponse.json({ error: "Couldn't import that board. Try again." }, { status: 500 });
  }
}

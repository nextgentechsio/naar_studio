import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { addBoardAsset } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST { url }: copy a library file (upload, picked output, element file) into the board's storage
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: unknown };
    const result = await addBoardAsset(auth.user, (await context.params).id, body?.url);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ asset: result.value });
  } catch (error) {
    console.error("Add board file error:", error);
    return NextResponse.json({ error: "Couldn't add that file" }, { status: 500 });
  }
}

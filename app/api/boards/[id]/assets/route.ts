import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { addBoardAsset, addRemoteAsset } from "@/lib/boards/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST { url }: copy a library file (upload, picked output, element file) into the board's storage.
// POST { remoteUrl }: download a picture or video from another website (pasted or dropped) into it.
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: unknown; remoteUrl?: unknown };
    const id = (await context.params).id;
    const result = body?.remoteUrl !== undefined ? await addRemoteAsset(auth.user, id, body.remoteUrl) : await addBoardAsset(auth.user, id, body?.url);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ asset: result.value });
  } catch (error) {
    console.error("Add board file error:", error);
    return NextResponse.json({ error: "Couldn't add that file" }, { status: 500 });
  }
}

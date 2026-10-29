import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createCut, cutsStorageEnabled, listCuts } from "@/lib/cuts/server";

export const runtime = "nodejs";

// GET → { cuts, storage }: the user's edit projects,
// most recently changed first
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ cuts: await listCuts(auth.user.id), storage: cutsStorageEnabled() });
  } catch (error) {
    console.error("List cuts error:", error);
    return NextResponse.json({ error: "Couldn't load your cuts" }, { status: 500 });
  }
}

// POST { name? } → { cut }
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  try {
    const result = await createCut(auth.user.id, body.name);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ cut: result.value }, { status: 201 });
  } catch (error) {
    console.error("Create cut error:", error);
    return NextResponse.json({ error: "Couldn't create the cut" }, { status: 500 });
  }
}

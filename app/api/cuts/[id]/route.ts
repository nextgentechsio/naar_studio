import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteCut, getCut, saveCut } from "@/lib/cuts/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// GET → { cut } (with its timeline and version)
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;

  try {
    const cut = await getCut(auth.user.id, id);
    if (!cut) return NextResponse.json({ error: "Cut not found" }, { status: 404 });
    return NextResponse.json({ cut });
  } catch (error) {
    console.error("Get cut error:", error);
    return NextResponse.json({ error: "Couldn't load the cut" }, { status: 500 });
  }
}

// PATCH { version, name?, timeline?, durationMs?, posterUrl? }
//   → { cut }; 409 when another save came first
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await saveCut(auth.user.id, id, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ cut: result.value });
  } catch (error) {
    console.error("Save cut error:", error);
    return NextResponse.json({ error: "Couldn't save the cut" }, { status: 500 });
  }
}

// The project and all of its files
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;

  try {
    if (!(await deleteCut(auth.user.id, id))) {
      return NextResponse.json({ error: "Cut not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete cut error:", error);
    return NextResponse.json({ error: "Couldn't delete the cut" }, { status: 500 });
  }
}

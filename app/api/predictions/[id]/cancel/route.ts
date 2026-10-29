import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { cancelGeneration } from "@/lib/generation-cancel";
import { canViewGeneration, getGeneration } from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// --------------------------------------------------
// POST: stop a running generation (any platform, see
// lib/generation-cancel.ts) → { status }, what it ended
// as. Its owner, or an admin who can see it.
// --------------------------------------------------

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const generation = id ? await getGeneration(id) : null;

  if (!generation || !canViewGeneration(auth.user, generation)) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  try {
    const result = await cancelGeneration(generation);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error("Cancel generation error:", id, error);
    return NextResponse.json({ error: "Couldn't cancel this run" }, { status: 500 });
  }
}

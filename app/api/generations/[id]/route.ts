import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  deleteGeneration,
  getGenerationForViewer,
  setGenerationHidden,
} from "@/lib/generations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// One generation with its inputs (for "Run again").
// Someone else's generation is reported as not found,
// so ids can't be probed.
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const generation = await getGenerationForViewer(auth.user, id);

    if (!generation) {
      return NextResponse.json(
        { error: "Generation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ generation });
  } catch (error) {
    console.error("Read generation error:", error);

    return NextResponse.json(
      { error: "Failed to load generation" },
      { status: 500 }
    );
  }
}

// Removes a finished run and its saved output from
// History, and its expense; the super admin only.
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser(["super_admin"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const result = await deleteGeneration(id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete generation error:", error);

    return NextResponse.json(
      { error: "Failed to delete generation" },
      { status: 500 }
    );
  }
}

// { hidden: true | false }: hides a finished run from
// everyone but the super admin, or shows it again; the
// super admin only
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser(["super_admin"]);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as { hidden?: unknown } | null;

  if (typeof body?.hidden !== "boolean") {
    return NextResponse.json({ error: "Say whether to hide it (hidden: true or false)" }, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const result = await setGenerationHidden(id, body.hidden);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ hidden: result.hidden });
  } catch (error) {
    console.error("Hide generation error:", error);

    return NextResponse.json(
      { error: "Failed to update generation" },
      { status: 500 }
    );
  }
}

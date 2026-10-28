import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteElement, updateElement } from "@/lib/elements";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// PATCH { name?, description?, images?, videos?, audios? }
//                                     → { element }
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) ?? {};

  try {
    const result = await updateElement(auth.user.id, id, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ element: result.element });
  } catch (error) {
    console.error("Update element error:", error);
    return NextResponse.json({ error: "Couldn't save the element" }, { status: 500 });
  }
}

// The element only: its images stay in the library
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;

  try {
    if (!(await deleteElement(auth.user.id, id))) {
      return NextResponse.json({ error: "Element not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete element error:", error);
    return NextResponse.json({ error: "Couldn't delete the element" }, { status: 500 });
  }
}

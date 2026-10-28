import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createElement, listElements } from "@/lib/elements";

export const runtime = "nodejs";

// --------------------------------------------------
// THE SIGNED-IN USER'S ELEMENTS (lib/elements.ts)
//
// GET                                → { elements }
// POST { name, description, images, videos, audios }
//                                    → { element }
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ elements: await listElements(auth.user.id) });
  } catch (error) {
    console.error("List elements error:", error);
    return NextResponse.json({ error: "Couldn't load your elements" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) ?? {};

  try {
    const result = await createElement(auth.user.id, body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ element: result.element }, { status: 201 });
  } catch (error) {
    console.error("Create element error:", error);
    return NextResponse.json({ error: "Couldn't save the element" }, { status: 500 });
  }
}

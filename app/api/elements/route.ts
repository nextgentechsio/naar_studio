import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { canViewAllMedia } from "@/lib/auth/roles";
import { createElement, listAllElements, listElements } from "@/lib/elements";

export const runtime = "nodejs";

// --------------------------------------------------
// THE SIGNED-IN USER'S ELEMENTS (lib/elements.ts)
//
// GET                                → { elements }
// GET ?scope=all (super admin)       → everyone's, each
//                                      with addedBy
// POST { name, description, images, videos, audios }
//                                    → { element }
// --------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const everyone = new URL(request.url).searchParams.get("scope") === "all";
  if (everyone && !canViewAllMedia(auth.user)) {
    return NextResponse.json({ error: "Only the super admin can see everyone's elements" }, { status: 403 });
  }

  try {
    return NextResponse.json({ elements: everyone ? await listAllElements() : await listElements(auth.user.id) });
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

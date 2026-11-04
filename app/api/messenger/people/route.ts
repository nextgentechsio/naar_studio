import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { listPeople } from "@/lib/messenger/server";

export const runtime = "nodejs";

// GET → { people }: everyone the signed-in user can
// message (active accounts, not themselves; names only)
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ people: await listPeople(auth.user) });
  } catch (error) {
    console.error("List people error:", error);
    return NextResponse.json({ error: "Couldn't load people" }, { status: 500 });
  }
}

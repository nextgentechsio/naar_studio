import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { leaveGroup, MessengerError } from "@/lib/messenger/server";

export const runtime = "nodejs";

// POST → 204: the signed-in member leaves the group (the
// last one out deletes it)
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    await leaveGroup(auth.user, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Leave group error:", error);
    return NextResponse.json({ error: "Couldn't leave the group" }, { status: 500 });
  }
}

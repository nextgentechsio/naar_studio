import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createGroup, MessengerError } from "@/lib/messenger/server";

export const runtime = "nodejs";

// POST { name, members: userIds } → { conversation }: a new
// group with the creator in it (admins and the super admin)
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const conversation = await createGroup(auth.user, await request.json().catch(() => null));
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Create group error:", error);
    return NextResponse.json({ error: "Couldn't create the group" }, { status: 500 });
  }
}

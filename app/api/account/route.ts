import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { updateOwnEmail } from "@/lib/auth/users";

export const runtime = "nodejs";

// --------------------------------------------------
// THE SIGNED-IN ACCOUNT'S OWN SETTINGS
// PATCH { email } sets (or, when blank, clears) the
// email they can also sign in with.
// --------------------------------------------------

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    if (!body || body.email === undefined) {
      return NextResponse.json({ error: "Email is required (blank to remove it)" }, { status: 400 });
    }

    const result = await updateOwnEmail(auth.user, body.email);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ user: result.user });
  } catch (error) {
    console.error("Update own email error:", error);
    return NextResponse.json({ error: "Couldn't save your email" }, { status: 500 });
  }
}

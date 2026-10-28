import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { recordSignOut } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function POST() {
  // Show the user offline straight away (best effort:
  // signing out must work even if this fails)
  const payload = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);

  if (payload) {
    await recordSignOut(payload.uid).catch((error) =>
      console.error("Record sign-out error:", error)
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);

  return response;
}

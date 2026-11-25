import { NextResponse } from "next/server";
import { setPasswordFromLink } from "@/lib/auth/users";
import { consumePasswordToken, passwordTokenValid, releasePasswordToken } from "@/lib/mail/password-tokens";

export const runtime = "nodejs";

// --------------------------------------------------
// SET A PASSWORD from a one-time link (forgot password,
// or the welcome email). Signs the account out
// everywhere; then it signs in with the new password.
// --------------------------------------------------

const EXPIRED = "This link has expired or was already used. Ask for a new one.";

// Is the link still good? (before asking for a password)
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return NextResponse.json({ valid: await passwordTokenValid(token) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = body?.token;

  const userId = await consumePasswordToken(token);
  if (!userId) return NextResponse.json({ error: EXPIRED }, { status: 400 });

  try {
    const result = await setPasswordFromLink(userId, body?.password);
    if (!result.ok) {
      // A password that doesn't meet the rules: the link
      // still works for the next try
      if (result.status === 400 && typeof token === "string") await releasePasswordToken(token);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Reset password error:", error);
    if (typeof token === "string") await releasePasswordToken(token).catch(() => undefined);
    return NextResponse.json({ error: "Couldn't set the password. Try again." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createLoginThrottle } from "@/lib/auth/login-throttle";
import { findUserByIdentifier } from "@/lib/auth/users";
import { mailConfigured, sendMailLater } from "@/lib/mail/graph";
import { createPasswordToken } from "@/lib/mail/password-tokens";
import { appUrl, resetEmail } from "@/lib/mail/templates";

export const runtime = "nodejs";

// --------------------------------------------------
// FORGOT PASSWORD: emails a one-time link to the
// account's address. Always answers the same, so it
// can't be used to find out who has an account.
// --------------------------------------------------

// Its own limit (5 per 15 minutes per name), apart from
// sign-in attempts
const throttle = createLoginThrottle();

const SENT = {
  ok: true,
  message: "If that account has an email address, a link to reset the password is on its way. It works for 1 hour.",
};

export async function POST(request: Request) {
  if (!mailConfigured()) {
    return NextResponse.json({ error: "Email isn't set up here. Ask your admin to reset your password." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { identifier?: unknown } | null;
  const identifier = body?.identifier;
  if (typeof identifier !== "string" || !identifier.trim()) {
    return NextResponse.json({ error: "Enter your username or email" }, { status: 400 });
  }

  const key = throttle.key(identifier);
  if (!throttle.tryAttempt(key)) {
    return NextResponse.json({ error: "Too many requests. Try again in 15 minutes." }, { status: 429 });
  }

  const origin = appUrl(new URL(request.url).origin)!;
  // The lookup and the email happen after the answer
  sendMailLater(async () => {
    const user = await findUserByIdentifier(identifier.trim());
    if (!user || user.disabled || !user.email) return [];
    const token = await createPasswordToken(user.id, "reset");
    return [{ to: user.email, ...resetEmail({ name: user.name, username: user.username, resetUrl: `${origin}/reset-password?token=${token}` }) }];
  }, "password reset");

  return NextResponse.json(SENT);
}

import { NextResponse } from "next/server";
import {
  createSessionToken,
  isSessionConfigured,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { loginThrottle } from "@/lib/auth/login-throttle";
import {
  hasAnyUsers,
  startNewSession,
  toPublicUser,
  verifyCredentials,
} from "@/lib/auth/users";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isSessionConfigured()) {
      return NextResponse.json(
        {
          error:
            "SESSION_SECRET (32+ characters) is missing in .env.local",
        },
        { status: 500 }
      );
    }

    if (!(await hasAnyUsers())) {
      return NextResponse.json(
        {
          error:
            "No users exist yet. Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in .env.local and restart.",
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    const { username, password } =
      body && typeof body === "object" ? body : ({} as Record<string, unknown>);

    const key = loginThrottle.key(username);

    if (!loginThrottle.tryAttempt(key)) {
      return NextResponse.json(
        {
          error:
            "Too many failed attempts. Try again in 15 minutes.",
        },
        { status: 429 }
      );
    }

    const user = await verifyCredentials(
      username,
      password
    );

    if (!user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    loginThrottle.succeeded(key);

    // One session per account: this sign-in ends any
    // other device's session
    const sessionVersion = await startNewSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
    });

    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(user.id, sessionVersion),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      }
    );

    return response;
  } catch (error) {
    console.error("Login error:", error);

    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    );
  }
}

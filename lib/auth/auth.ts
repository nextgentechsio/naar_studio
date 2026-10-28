import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_REPLACED } from "@/lib/client/session-ended";
import type { Role } from "@/lib/roles";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/session";
import {
  findUserById,
  type StoredUser,
} from "@/lib/users";

// --------------------------------------------------
// CURRENT USER (authoritative check)
//
// proxy.ts only verifies the cookie signature. This also
// checks the user still exists, is enabled, and that the
// session wasn't revoked — call it in every route handler.
// --------------------------------------------------

// `replaced`: a valid cookie for an active account whose
// session was superseded by a sign-in on another device
// (one session per account). Other endings (password
// changed, disabled) just read as "ended".
export async function getSession(): Promise<{
  user: StoredUser | null;
  replaced: boolean;
}> {
  const cookieStore = await cookies();

  const payload = verifySessionToken(
    cookieStore.get(SESSION_COOKIE)?.value
  );

  if (!payload) return { user: null, replaced: false };

  const user = await findUserById(payload.uid);

  if (!user || user.disabled) return { user: null, replaced: false };

  if (user.sessionVersion !== payload.ver) {
    return {
      user: null,
      replaced: user.sessionEndReason !== "password",
    };
  }

  return { user, replaced: false };
}

export async function getCurrentUser(): Promise<StoredUser | null> {
  return (await getSession()).user;
}

type AuthResult =
  | { user: StoredUser; response?: undefined }
  | { user?: undefined; response: NextResponse };

export async function requireUser(
  roles?: Role[]
): Promise<AuthResult> {
  const { user, replaced } = await getSession();

  if (!user) {
    return {
      response: NextResponse.json(
        replaced
          ? {
              error: "You were signed out because your account signed in on another device.",
              code: SESSION_REPLACED,
            }
          : { error: "Not signed in" },
        { status: 401 }
      ),
    };
  }

  if (roles && !roles.includes(user.role)) {
    return {
      response: NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      ),
    };
  }

  return { user };
}

// When the current session began (ms since epoch), for
// the session timer. Tokens are issued with a fixed
// lifetime, so sign-in time = expiry − lifetime; no extra
// field (and no change for existing sessions) needed.
export async function getSessionStartedAt(): Promise<number | null> {
  const cookieStore = await cookies();
  const payload = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  return payload ? (payload.exp - SESSION_MAX_AGE_SECONDS) * 1000 : null;
}

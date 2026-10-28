import { createHmac, timingSafeEqual } from "crypto";

// --------------------------------------------------
// SIGNED SESSION TOKENS
//
// Cookie value: base64url(payload).base64url(hmac)
// No filesystem access here, so proxy.ts can use it
// for the fast signature/expiry check. Route handlers
// additionally check the user store (see lib/auth.ts).
// --------------------------------------------------

export const SESSION_COOKIE = "ai_studio_session";

export const SESSION_MAX_AGE_SECONDS =
  7 * 24 * 60 * 60;

export type SessionPayload = {
  uid: string;
  // Must match the user's sessionVersion; bumping it
  // (password reset, disable) revokes old sessions.
  ver: number;
  exp: number;
};

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;

  return secret && secret.length >= 32
    ? secret
    : null;
}

export function isSessionConfigured(): boolean {
  return getSecret() !== null;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
}

export function createSessionToken(
  uid: string,
  ver: number
): string {
  const secret = getSecret();

  if (!secret) {
    throw new Error(
      "SESSION_SECRET (32+ characters) is missing in .env.local"
    );
  }

  const payload: SessionPayload = {
    uid,
    ver,
    exp:
      Math.floor(Date.now() / 1000) +
      SESSION_MAX_AGE_SECONDS,
  };

  const data = Buffer.from(
    JSON.stringify(payload)
  ).toString("base64url");

  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(
  token: string | undefined | null
): SessionPayload | null {
  const secret = getSecret();

  if (!secret || !token) return null;

  const [data, signature, extra] = token.split(".");

  if (!data || !signature || extra !== undefined) {
    return null;
  }

  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);

  if (
    expected.length !== given.length ||
    !timingSafeEqual(expected, given)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf-8")
    ) as SessionPayload;

    if (
      typeof payload.uid !== "string" ||
      typeof payload.ver !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

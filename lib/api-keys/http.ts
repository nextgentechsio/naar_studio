import { NextResponse } from "next/server";
import type { StoredUser } from "@/lib/auth/users";
import { canUsePlatform } from "@/lib/auth/platforms";
import type { ApiKeyDoc } from "./db";
import { authenticateApiKey, touchApiKey } from "./keys";
import { rateLimited } from "./limits";
import { API_LIVE_PLATFORMS, type ApiErrorBody, type ApiKeyPlatform } from "./shared";
import { checkCapAlerts } from "./spend";

// --------------------------------------------------
// THE API'S REQUEST GUARD (/api/v1/*)
//
// Bearer key, then rate limit, then (for a start) the
// platform. Errors all have one shape:
//   { "error": { "code": "…", "message": "…" } }
// --------------------------------------------------

export function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status, headers });
}

export type ApiCaller = { key: ApiKeyDoc; user: StoredUser };

export type GuardResult = { caller: ApiCaller; response?: undefined } | { caller?: undefined; response: NextResponse };

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim().slice(0, 64) : null;
}

export async function requireApiKey(request: Request, options: { platform?: ApiKeyPlatform } = {}): Promise<GuardResult> {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.ok) {
    return { response: apiError(auth.code, auth.message, auth.status, { "WWW-Authenticate": "Bearer" }) };
  }

  const retryAfter = rateLimited(auth.key._id.toHexString());
  if (retryAfter !== null) {
    return {
      response: apiError("rate_limited", "Too many requests for this key. Slow down and retry.", 429, {
        "Retry-After": String(retryAfter),
      }),
    };
  }

  const { platform } = options;
  if (platform) {
    if (!API_LIVE_PLATFORMS.includes(platform)) {
      return { response: apiError("platform_unavailable", `${platform} isn't available through the API yet.`, 400) };
    }
    if (!auth.key.platforms.includes(platform) || !canUsePlatform(auth.user, platform)) {
      return { response: apiError("platform_not_allowed", `This key can't use ${platform}.`, 403) };
    }
  }

  // Bookkeeping never delays or fails the request
  void touchApiKey(auth.key, clientIp(request)).catch(() => undefined);
  void checkCapAlerts(auth.key).catch(() => undefined);

  return { caller: { key: auth.key, user: auth.user } };
}

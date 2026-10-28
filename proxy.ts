import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isSessionConfigured,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth/session";

// --------------------------------------------------
// SESSION GATE FOR THE WHOLE APP
//
// Optimistic check only (cookie signature + expiry).
// Route handlers do the authoritative check via
// requireUser() in lib/auth/auth.ts, which also catches
// disabled users and revoked sessions.
// --------------------------------------------------

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Fail closed: never run unprotected
  if (!isSessionConfigured()) {
    return new NextResponse(
      "SESSION_SECRET (32+ characters) must be set in .env.local",
      { status: 500 }
    );
  }

  const session = verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (PUBLIC_PATHS.has(pathname)) {
    if (session && pathname === "/login") {
      // The app found this session ended (signed in on
      // another device, disabled, password reset) and
      // sent us here with a reason. The cookie still has
      // a valid signature, so drop it, or "/login → / →
      // /login" would loop forever.
      if (request.nextUrl.searchParams.has("reason")) {
        const response = NextResponse.next();
        response.cookies.delete(SESSION_COOKIE);
        return response;
      }

      // Already signed in: skip the login page
      return NextResponse.redirect(
        new URL("/", request.url)
      );
    }

    return NextResponse.next();
  }

  if (session) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "Not signed in" },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + search);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except build assets and public brand
    // files (favicon, logos), which the login page needs.
    // API routes and public/history outputs are
    // intentionally included.
    //
    // Except /api/upload: the proxy buffers request bodies
    // and cuts them off at 10 MB, which broke larger input
    // files. That route checks the session itself
    // (requireUser), so it loses nothing.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/|api/upload$).*)",
  ],
};

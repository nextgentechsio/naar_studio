// --------------------------------------------------
// SESSION ENDED (browser only)
//
// Sends the browser to sign-in, coming back here after.
// "replaced" = this account signed in on another device
// (one session per account); the login page says so.
// --------------------------------------------------

// Also sent by the server (lib/auth/auth.ts) with the 401
export const SESSION_REPLACED = "session_replaced";

export function goToSignIn(code?: unknown) {
  const params = new URLSearchParams({
    next: window.location.pathname + window.location.search,
  });

  // A reason also tells the login page to drop the dead
  // cookie (see proxy.ts)
  params.set("reason", code === SESSION_REPLACED ? "replaced" : "ended");

  // Full reload on purpose: no client state should survive
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?${params}`);
}

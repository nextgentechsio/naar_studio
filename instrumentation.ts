// Sends this app's traces and logs to TraceLumo. Added by `npx @tracelumo/node init`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@tracelumo/node/register");
  }
}

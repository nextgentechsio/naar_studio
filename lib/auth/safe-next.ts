// --------------------------------------------------
// POST-LOGIN REDIRECT TARGET
//
// Only same-origin paths are allowed, so ?next= can't be
// used as an open redirect. The value is resolved the
// way the browser would resolve it (browsers strip tabs
// and newlines, so "/\t/evil.com" means "//evil.com"),
// and rejected unless it stays on our origin.
// --------------------------------------------------

export function safeNextPath(
  next: string | null | undefined,
  origin: string
): string {
  if (!next || !next.startsWith("/")) return "/";

  try {
    const url = new URL(next, origin);

    if (url.origin !== origin) return "/";

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

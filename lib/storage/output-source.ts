// --------------------------------------------------
// FETCHING REPLICATE OUTPUT FILES (server side)
//
// Output URLs come from prediction results, and any user
// can run any public Replicate model, including one that
// returns an arbitrary URL. Fetching it unchecked would
// let them reach internal hosts (SSRF), so only
// Replicate's output CDN is allowed, and every redirect
// hop is re-checked.
// --------------------------------------------------

const MAX_REDIRECTS = 3;

export function isReplicateDeliveryUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "replicate.delivery" ||
      url.hostname.endsWith(".replicate.delivery"))
  );
}

// Outputs a run may be saved from: Replicate's CDN, or
// the API host itself when REPLICATE_API_URL points the
// app at a stand-in (the integration tests' fake API).
export function isAllowedOutputSource(url: URL): boolean {
  if (isReplicateDeliveryUrl(url)) return true;

  const base = process.env.REPLICATE_API_URL;
  if (!base) return false;

  try {
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

// fetch() that follows redirects by hand, checking each
// hop. Throws if any hop is not allowed.
export async function fetchAllowed(
  start: URL,
  isAllowed: (url: URL) => boolean,
  init: RequestInit = {}
): Promise<Response> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowed(current)) {
      throw new Error(`Source not allowed: ${current.host}`);
    }

    const response = await fetch(current, {
      cache: "no-store",
      ...init,
      method: "GET",
      redirect: "manual",
    });

    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      // Not reading this hop's body: release it
      await response.body?.cancel();
      current = new URL(location, current);
      continue;
    }

    return response;
  }

  throw new Error("Too many redirects");
}

// --------------------------------------------------
// REPLICATE API
//
// One place for the API base URL and auth header.
// REPLICATE_API_URL exists so the integration tests can
// point the app at a local fake (no real runs, no cost);
// production leaves it unset.
// --------------------------------------------------

const DEFAULT_BASE = "https://api.replicate.com/v1";

export function replicateApiUrl(path: string): string {
  const base = (process.env.REPLICATE_API_URL || DEFAULT_BASE).replace(
    /\/+$/,
    ""
  );

  return `${base}/${path.replace(/^\/+/, "")}`;
}

export function replicateHeaders(
  extra: Record<string, string> = {}
): Record<string, string> | null {
  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) return null;

  return { Authorization: `Bearer ${token}`, ...extra };
}

// Read a Replicate response body without throwing on
// empty or non-JSON bodies
export async function readReplicateJson(
  response: Response
): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");

  try {
    const data = text ? JSON.parse(text) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

// Replicate's own error text (safe to show: it's about
// the user's inputs, never our internals)
export function replicateErrorMessage(
  data: Record<string, unknown>,
  fallback: string
): string {
  const detail = data.detail ?? data.error ?? data.title;

  return typeof detail === "string" && detail.length <= 500
    ? detail
    : fallback;
}

// Our status for a failed Replicate call. Replicate's
// own 401/403 are about OUR token, so they must never
// reach the browser as-is (it would read them as the
// user's session ending and sign them out).
export function upstreamStatus(status: number): number {
  if (status === 404) return 404;
  if (status === 400 || status === 422) return 422;
  if (status === 429) return 429;
  return 502;
}

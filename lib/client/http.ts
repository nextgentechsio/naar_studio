import { goToSignIn } from "@/lib/client/session-ended";

// --------------------------------------------------
// FETCH HELPER (browser only)
//
// Reads JSON defensively: an empty or non-JSON body
// (a crashed route, a proxy error page) becomes a
// readable Error instead of a JSON parse crash. A 401
// means the session ended, so go back to sign-in and
// return here afterwards.
// --------------------------------------------------

// An error response from our API, with what was asked.
// Its message is the server's readable reason.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message);
  }
}

// Logs a failed request. Our API's own error responses are
// expected (the page shows them) so they're warnings, which
// the dev overlay doesn't pop up for; anything else (a
// crash, a network failure) stays an error.
export function logRequestError(error: unknown, context?: string) {
  if (error instanceof ApiError) {
    console.warn(`${context ? `${context}: ` : ""}${error.url} → ${error.status}: ${error.message}`);
  } else {
    console.error(context ?? "Request failed:", error);
  }
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  const text = await response.text();

  let data: unknown = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from the server (${response.status})`
    );
  }

  if (response.status === 401) {
    goToSignIn((data as { code?: unknown }).code);

    throw new Error("Your session has ended. Please sign in again.");
  }

  if (!response.ok) {
    throw new ApiError(
      (data as { error?: string }).error ||
        `Request failed (${response.status})`,
      url,
      response.status
    );
  }

  return data as T;
}

export function errorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}

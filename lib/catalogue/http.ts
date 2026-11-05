import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { platformDenied } from "@/lib/auth/platform-access";
import type { StoredUser } from "@/lib/auth/users";
import { CatalogueError } from "./library";

// --------------------------------------------------
// CATALOGUE API: signed-in users allowed on the Catalogue
// platform (lib/auth/platforms.ts) only; a CatalogueError
// becomes { error } with its status, anything else a 500
// --------------------------------------------------

export async function catalogueRoute(
  work: (user: StoredUser) => Promise<unknown>,
): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const denied = platformDenied(auth.user, "catalogue");
  if (denied) return denied;
  try {
    const result = await work(auth.user);
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof CatalogueError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalogue API error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CatalogueError(400, "Invalid request body");
  return body as Record<string, unknown>;
}

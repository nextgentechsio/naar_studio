import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { rotateApiKey } from "@/lib/api-keys/keys";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

type RouteContext = { params: Promise<{ id: string }> };

// POST: a new secret for the key (shown once); the old
// one stops working at once
export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const result = await rotateApiKey(auth.user, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ key: result.key, secret: result.secret });
  } catch (error) {
    console.error("Rotate API key error:", error);
    return NextResponse.json({ error: "Failed to rotate the API key" }, { status: 500 });
  }
}

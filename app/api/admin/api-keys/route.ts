import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createApiKey, listApiKeys } from "@/lib/api-keys/keys";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

// --------------------------------------------------
// ADMIN: API KEYS
// GET lists the keys the manager may see (with this
// month's spend); POST creates one and returns the secret
// once.
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ keys: await listApiKeys(auth.user) });
  } catch (error) {
    console.error("List API keys error:", error);
    return NextResponse.json({ error: "Failed to load API keys" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await createApiKey(auth.user, body ?? {});
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ key: result.key, secret: result.secret }, { status: 201 });
  } catch (error) {
    console.error("Create API key error:", error);
    return NextResponse.json({ error: "Failed to create the API key" }, { status: 500 });
  }
}

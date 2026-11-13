import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { revokeApiKey, updateApiKey } from "@/lib/api-keys/keys";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

type RouteContext = { params: Promise<{ id: string }> };

// PATCH changes a key's name, projects, platforms, cap,
// runs at once or expiry; DELETE revokes it (its runs and
// spend stay)
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await updateApiKey(auth.user, id, body ?? {});
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ key: result.key });
  } catch (error) {
    console.error("Update API key error:", error);
    return NextResponse.json({ error: "Failed to update the API key" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const result = await revokeApiKey(auth.user, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ key: result.key });
  } catch (error) {
    console.error("Revoke API key error:", error);
    return NextResponse.json({ error: "Failed to revoke the API key" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteAsset, updateAssetMeta } from "@/lib/cuts/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
    assetId: string;
  }>;
};

// PATCH { durationMs?, width?, height?, peaks? } → { asset }
// What the editor measured, so it isn't measured again
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id, assetId } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await updateAssetMeta(auth.user.id, id, assetId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ asset: result.value });
  } catch (error) {
    console.error("Update cut file error:", error);
    return NextResponse.json({ error: "Couldn't update the file" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id, assetId } = await context.params;

  try {
    if (!(await deleteAsset(auth.user.id, id, assetId))) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete cut file error:", error);
    return NextResponse.json({ error: "Couldn't delete the file" }, { status: 500 });
  }
}

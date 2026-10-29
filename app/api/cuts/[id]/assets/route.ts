import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { addAsset, listAssets } from "@/lib/cuts/server";

export const runtime = "nodejs";
// Copying a long video into the project can take a while
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// GET → { assets }: the project's own files
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;

  try {
    const assets = await listAssets(auth.user.id, id);
    if (!assets) return NextResponse.json({ error: "Cut not found" }, { status: 404 });
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("List cut files error:", error);
    return NextResponse.json({ error: "Couldn't load the cut's files" }, { status: 500 });
  }
}

// POST { source: "generation", id } | { source: "element", url }
//    | { source: "upload" | "export", url } → { asset }
// Outputs and element files are copied into the cut's
// own folder; uploads and exports are already there.
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await addAsset(auth.user, id, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ asset: result.value }, { status: 201 });
  } catch (error) {
    console.error("Add cut file error:", error);
    return NextResponse.json({ error: "Couldn't add the file. Please try again." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { saveGenerationToLibrary } from "@/lib/storage/media-library";

export const runtime = "nodejs";

// POST { generationId } → { file }: a run's output copied
// into the signed-in user's library, for reuse or to add
// to an element (lib/storage/media-library.ts)
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as { generationId?: unknown } | null;
  if (typeof body?.generationId !== "string" || !body.generationId) {
    return NextResponse.json({ error: "Which run?" }, { status: 400 });
  }

  try {
    const result = await saveGenerationToLibrary(auth.user, body.generationId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ file: result.file });
  } catch (error) {
    console.error("Save run to library error:", error);
    return NextResponse.json({ error: "Couldn't save it to the library. Please try again." }, { status: 500 });
  }
}

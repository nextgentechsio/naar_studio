import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteLibraryFile } from "@/lib/storage/media-library";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// Deletes one of the signed-in user's library files
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const result = await deleteLibraryFile(auth.user.id, id);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete library file error:", error);
    return NextResponse.json({ error: "Couldn't delete the file" }, { status: 500 });
  }
}

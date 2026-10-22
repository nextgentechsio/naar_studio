import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { findHiggsfieldModel, formSchema } from "@/lib/higgsfield";

export const runtime = "nodejs";

// One Higgsfield model's settings, shaped like a Replicate
// model's (/api/models/schema), so the Generate form can
// show either. ?model=<slug>
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const model = new URL(request.url).searchParams.get("model") ?? "";

  try {
    const record = model ? await findHiggsfieldModel(model) : null;

    if (!record) {
      return NextResponse.json({ error: "Unknown Higgsfield model" }, { status: 404 });
    }

    return NextResponse.json({ inputSchema: formSchema(record) });
  } catch (error) {
    console.error(
      "Higgsfield schema error:",
      error instanceof Error ? error.message : "unknown error"
    );

    return NextResponse.json(
      { error: "Couldn't load the model's settings" },
      { status: 502 }
    );
  }
}

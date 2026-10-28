import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  HiggsfieldRequestError,
  higgsfieldConfigured,
  listHiggsfieldModels,
} from "@/lib/higgsfield/client";

export const runtime = "nodejs";

// Every model Higgsfield offers (no input schemas: see
// ./schema), and whether the server can run them at all
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  if (!higgsfieldConfigured()) {
    return NextResponse.json({ enabled: false, models: [] });
  }

  try {
    return NextResponse.json({ enabled: true, models: await listHiggsfieldModels() });
  } catch (error) {
    console.error(
      "Higgsfield model list error:",
      error instanceof Error ? error.message : "unknown error"
    );

    return NextResponse.json(
      {
        error:
          error instanceof HiggsfieldRequestError && error.keyRejected
            ? "Higgsfield rejected the server's API key (it may be disabled or revoked). An admin needs to update HF_CREDENTIALS."
            : "Couldn't load Higgsfield's models",
      },
      { status: 502 }
    );
  }
}

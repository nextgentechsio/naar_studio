import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { elevenLabsConfigured } from "@/lib/elevenlabs/client";
import { ELEVENLABS_MODELS, elevenLabsModelInfo } from "@/lib/elevenlabs/models";

export const runtime = "nodejs";

// ElevenLabs' tools as models (lib/elevenlabs/models.ts),
// and whether the server can run them at all
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({
    enabled: elevenLabsConfigured(),
    models: elevenLabsConfigured() ? ELEVENLABS_MODELS.map(elevenLabsModelInfo) : [],
  });
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { ElevenLabsError, elevenLabsConfigured, listVoices } from "@/lib/elevenlabs/client";
import { elevenLabsSchema, findElevenLabsModel } from "@/lib/elevenlabs/models";

export const runtime = "nodejs";

// One model's form (?model=tts/eleven_multilingual_v2),
// with the account's voices where it needs one
export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const item = findElevenLabsModel(new URL(request.url).searchParams.get("model") ?? "");
  if (!item) return NextResponse.json({ error: "Unknown ElevenLabs model" }, { status: 404 });

  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "ElevenLabs is not configured on the server" }, { status: 500 });
  }

  try {
    const needsVoice = item.tool === "tts" || item.tool === "voice-changer";
    const voices = needsVoice ? await listVoices() : [];

    if (needsVoice && !voices.length) {
      return NextResponse.json({ error: "The ElevenLabs account has no voices yet." }, { status: 502 });
    }

    return NextResponse.json({ inputSchema: elevenLabsSchema(item, voices) });
  } catch (error) {
    console.error("ElevenLabs voices error:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      {
        error:
          error instanceof ElevenLabsError && error.keyRejected
            ? error.message
            : "Couldn't load ElevenLabs' voices. Please try again.",
      },
      { status: 502 }
    );
  }
}

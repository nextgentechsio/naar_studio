import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { assistantConfigured } from "@/lib/assistant/run";
import { createChat, listChats } from "@/lib/assistant/store";

export const runtime = "nodejs";

// --------------------------------------------------
// ASSISTANT CHATS (lib/assistant): the signed-in user's
//
// GET  → { chats, configured }
// POST → { chat }: a new, empty chat
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ chats: await listChats(auth.user.id), configured: assistantConfigured() });
  } catch (error) {
    console.error("List assistant chats error:", error);
    return NextResponse.json({ error: "Couldn't load your chats" }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ chat: await createChat(auth.user.id) }, { status: 201 });
  } catch (error) {
    console.error("Create assistant chat error:", error);
    return NextResponse.json({ error: "Couldn't start a chat" }, { status: 500 });
  }
}

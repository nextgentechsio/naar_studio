import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { listAllConversations, listConversations, MessengerError, openConversation } from "@/lib/messenger/server";

export const runtime = "nodejs";

// --------------------------------------------------
// CHATS (lib/messenger/server.ts)
//
// GET               → { conversations, unread }
// GET ?scope=all    → { conversations }: every chat,
//                     read only (super admin)
// POST { userId }   → { conversation }: the chat with
//                     them (made the first time)
// --------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const all = new URL(request.url).searchParams.get("scope") === "all";

  try {
    return NextResponse.json(all ? await listAllConversations(auth.user) : await listConversations(auth.user));
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("List conversations error:", error);
    return NextResponse.json({ error: "Couldn't load chats" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const body = ((await request.json().catch(() => null)) ?? {}) as { userId?: unknown };
    return NextResponse.json({ conversation: await openConversation(auth.user, body.userId) });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Open conversation error:", error);
    return NextResponse.json({ error: "Couldn't open the chat" }, { status: 500 });
  }
}

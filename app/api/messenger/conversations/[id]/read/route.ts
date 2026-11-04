import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { markConversationRead, MessengerError } from "@/lib/messenger/server";

export const runtime = "nodejs";

// POST → 204: the signed-in member has read the chat
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    await markConversationRead(auth.user, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Mark chat read error:", error);
    return NextResponse.json({ error: "Couldn't update the chat" }, { status: 500 });
  }
}

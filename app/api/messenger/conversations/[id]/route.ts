import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteConversation, MessengerError } from "@/lib/messenger/server";

export const runtime = "nodejs";

// DELETE → 204: removes a whole chat (direct or group)
// and its messages, for everyone in it (super admin only)
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    await deleteConversation(auth.user, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Delete chat error:", error);
    return NextResponse.json({ error: "Couldn't delete the chat" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteMessage, MessengerError } from "@/lib/messenger/server";

export const runtime = "nodejs";

// DELETE → 204: removes one message from any chat, for
// everyone in it (super admin only)
export async function DELETE(_request: Request, context: { params: Promise<{ id: string; messageId: string }> }) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id, messageId } = await context.params;

  try {
    await deleteMessage(auth.user, id, messageId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Delete message error:", error);
    return NextResponse.json({ error: "Couldn't delete the message" }, { status: 500 });
  }
}

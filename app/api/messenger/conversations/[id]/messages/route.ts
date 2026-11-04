import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { listMessages, MessengerError, sendMessage } from "@/lib/messenger/server";

export const runtime = "nodejs";

// --------------------------------------------------
// MESSAGES IN A CHAT (members; the super admin may read)
//
// GET                 → { messages, hasMore, otherReadAt }
//                       the latest page, oldest first
// GET ?before=<id>    → the page before that message
// GET ?after=<id>     → messages since that one
// POST { body }       → { message }
// --------------------------------------------------

type Context = { params: Promise<{ id: string }> };

function failed(error: unknown, label: string, message: string) {
  if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(label, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;

  try {
    return NextResponse.json(await listMessages(auth.user, id, { before: params.get("before"), after: params.get("after") }));
  } catch (error) {
    return failed(error, "List messages error:", "Couldn't load messages");
  }
}

export async function POST(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    const message = await sendMessage(auth.user, id, await request.json().catch(() => null));
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return failed(error, "Send message error:", "Couldn't send the message");
  }
}

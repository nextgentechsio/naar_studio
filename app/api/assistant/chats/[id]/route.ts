import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteAttachments } from "@/lib/assistant/attachments";
import { ChatError, deleteChat, getChat, renameChat } from "@/lib/assistant/store";

export const runtime = "nodejs";

// --------------------------------------------------
// ONE ASSISTANT CHAT (its owner only)
//
// GET              → { chat } with its turns
// PATCH { title }  → { chat }
// DELETE           → 204 (its attachments go too)
// --------------------------------------------------

type Context = { params: Promise<{ id: string }> };

function failed(error: unknown, label: string) {
  if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(label, error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(_request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    return NextResponse.json({ chat: await getChat(auth.user.id, id) });
  } catch (error) {
    return failed(error, "Get assistant chat error:");
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const body = ((await request.json().catch(() => null)) ?? {}) as { title?: unknown };

  try {
    return NextResponse.json({ chat: await renameChat(auth.user.id, id, body.title) });
  } catch (error) {
    return failed(error, "Rename assistant chat error:");
  }
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    await deleteAttachments(await deleteChat(auth.user.id, id));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return failed(error, "Delete assistant chat error:");
  }
}

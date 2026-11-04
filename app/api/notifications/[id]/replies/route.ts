import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  addReply,
  listReplies,
  markRepliesSeen,
  NotificationAccessError,
  NotificationInputError,
} from "@/lib/notifications";

export const runtime = "nodejs";

// --------------------------------------------------
// REPLIES TO A NOTIFICATION (lib/notifications.ts)
//
// Private threads: each recipient with the super admin.
// GET                 → { threads } (yours; all for the
//                       super admin)
// POST { body, to? }  → { reply } (to: the thread's user,
//                       super admin only)
// PATCH { seen: true, thread? } → 204 (marks the other
//                       side's replies seen)
// --------------------------------------------------

type Context = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Notification not found" }, { status: 404 });

export async function GET(_request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    const threads = await listReplies(auth.user, id);
    return threads ? NextResponse.json({ threads }) : notFound();
  } catch (error) {
    console.error("List replies error:", error);
    return NextResponse.json({ error: "Couldn't load replies" }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  try {
    const reply = await addReply(auth.user, id, await request.json().catch(() => null));
    return NextResponse.json({ reply }, { status: 201 });
  } catch (error) {
    if (error instanceof NotificationAccessError) return notFound();
    if (error instanceof NotificationInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Reply error:", error);
    return NextResponse.json({ error: "Couldn't send the reply" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;

  const body = ((await request.json().catch(() => null)) ?? {}) as { seen?: unknown; thread?: unknown };
  if (body.seen !== true || (body.thread !== undefined && typeof body.thread !== "string")) {
    return NextResponse.json({ error: "Send seen: true (and thread: a user id)" }, { status: 400 });
  }

  try {
    if (!(await markRepliesSeen(auth.user, id, body.thread as string | undefined))) return notFound();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Mark replies seen error:", error);
    return NextResponse.json({ error: "Couldn't update replies" }, { status: 500 });
  }
}

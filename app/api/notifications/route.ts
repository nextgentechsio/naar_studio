import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { canSendNotifications } from "@/lib/auth/roles";
import {
  listNotifications,
  markNotificationsRead,
  NotificationInputError,
  parseNotification,
  sendNotification,
} from "@/lib/notifications";

export const runtime = "nodejs";

// --------------------------------------------------
// NOTIFICATIONS (lib/notifications.ts)
//
// GET                         → { notifications, unread }
//                               (any signed-in user)
// POST { title, body, level, to } → { notification }
//                               (super admin; to: "everyone"
//                               or a list of user ids)
// PATCH { read: ids | "all" } → 204 (marks them read)
// --------------------------------------------------

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json(await listNotifications(auth.user));
  } catch (error) {
    console.error("List notifications error:", error);
    return NextResponse.json({ error: "Couldn't load notifications" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canSendNotifications(auth.user)) {
    return NextResponse.json({ error: "Only the super admin can send notifications" }, { status: 403 });
  }

  try {
    const input = parseNotification(await request.json().catch(() => null));
    const notification = await sendNotification(auth.user, input);
    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    if (error instanceof NotificationInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Send notification error:", error);
    return NextResponse.json({ error: "Couldn't send the notification" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = ((await request.json().catch(() => null)) ?? {}) as { read?: unknown };
  const ids =
    body.read === "all"
      ? undefined
      : Array.isArray(body.read) && body.read.every((id) => typeof id === "string") && body.read.length <= 100
        ? (body.read as string[])
        : null;
  if (ids === null) {
    return NextResponse.json({ error: 'Send read: a list of ids, or "all"' }, { status: 400 });
  }

  try {
    await markNotificationsRead(auth.user, ids);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    return NextResponse.json({ error: "Couldn't update notifications" }, { status: 500 });
  }
}

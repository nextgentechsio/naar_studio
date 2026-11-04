import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { canSendNotifications } from "@/lib/auth/roles";
import { deleteNotification, recallNotification } from "@/lib/notifications";

export const runtime = "nodejs";

// Super admin only:
// PATCH { recall: true } → 204: takes it back from its
//   recipients (kept, marked recalled, for the sender)
// DELETE → 204: removes it completely

export async function PATCH(request: Request, context: RouteContext<"/api/notifications/[id]">) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canSendNotifications(auth.user)) {
    return NextResponse.json({ error: "Only the super admin can recall notifications" }, { status: 403 });
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as { recall?: unknown };
  if (body.recall !== true) {
    return NextResponse.json({ error: "Send recall: true" }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    if (!(await recallNotification(id))) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Recall notification error:", error);
    return NextResponse.json({ error: "Couldn't recall the notification" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext<"/api/notifications/[id]">) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  if (!canSendNotifications(auth.user)) {
    return NextResponse.json({ error: "Only the super admin can delete notifications" }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    if (!(await deleteNotification(id))) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete notification error:", error);
    return NextResponse.json({ error: "Couldn't delete the notification" }, { status: 500 });
  }
}

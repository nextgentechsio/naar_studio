import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { deleteGroup, getGroup, MessengerError, updateGroup } from "@/lib/messenger/server";

export const runtime = "nodejs";

// --------------------------------------------------
// ONE GROUP (admins in it, or the super admin)
//
// GET                          → { conversation }
// PATCH { name?, add?, remove? } → { conversation }
//   (add / remove: user ids; each change is posted in
//   the group)
// DELETE                       → 204, messages included
// --------------------------------------------------

type Context = { params: Promise<{ id: string }> };

function failed(error: unknown, label: string) {
  if (error instanceof MessengerError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(label, error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(_request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ conversation: await getGroup(auth.user, id) });
  } catch (error) {
    return failed(error, "Get group error:");
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    return NextResponse.json({ conversation: await updateGroup(auth.user, id, await request.json().catch(() => null)) });
  } catch (error) {
    return failed(error, "Update group error:");
  }
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    await deleteGroup(auth.user, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return failed(error, "Delete group error:");
  }
}

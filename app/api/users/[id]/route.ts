import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import {
  deleteUser,
  findUserById,
  updateUser,
} from "@/lib/auth/users";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const result = await updateUser(auth.user, id, {
      name: body?.name,
      role: body?.role,
      disabled: body?.disabled,
      password: body?.password,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    const response = NextResponse.json({
      user: result.user,
    });

    // Changing your own password revokes old sessions;
    // re-issue this one so the actor stays signed in.
    if (id === auth.user.id && body?.password) {
      const fresh = await findUserById(id);

      if (fresh) {
        response.cookies.set(
          SESSION_COOKIE,
          createSessionToken(fresh.id, fresh.sessionVersion),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: SESSION_MAX_AGE_SECONDS,
          }
        );
      }
    }

    return response;
  } catch (error) {
    console.error("Update user error:", error);

    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const { id } = await context.params;

    const result = await deleteUser(auth.user, id);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete user error:", error);

    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}

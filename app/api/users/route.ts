import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createUser, listUsers } from "@/lib/auth/users";

export const runtime = "nodejs";

const MANAGERS = ["super_admin", "admin"] as const;

export async function GET() {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({
      // Online status is for the super admin only
      users: await listUsers({
        withPresence: auth.user.role === "super_admin",
      }),
    });
  } catch (error) {
    console.error("List users error:", error);

    return NextResponse.json(
      { error: "Failed to load users" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser([...MANAGERS]);
  if (auth.response) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));

    const result = await createUser(auth.user, body ?? {});

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { user: result.user },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);

    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}

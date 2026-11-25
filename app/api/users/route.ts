import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { createUser, listUsers } from "@/lib/auth/users";
import { mailConfigured, sendMailLater } from "@/lib/mail/graph";
import { createPasswordToken } from "@/lib/mail/password-tokens";
import { appUrl, welcomeEmail } from "@/lib/mail/templates";

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

    // A welcome email when the account has an address
    const created = result.user;
    if (created.email && mailConfigured()) {
      const origin = appUrl(new URL(request.url).origin)!;
      const createdBy = auth.user.name;
      sendMailLater(async () => {
        const token = await createPasswordToken(created.id, "welcome");
        return [
          {
            to: created.email!,
            ...welcomeEmail({
              name: created.name,
              username: created.username,
              email: created.email!,
              createdBy,
              signInUrl: `${origin}/login`,
              setPasswordUrl: `${origin}/reset-password?token=${token}&welcome=1`,
            }),
          },
        ];
      }, "welcome");
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

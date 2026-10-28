import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { toPublicUser } from "@/lib/auth/users";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  return NextResponse.json({
    user: toPublicUser(auth.user),
  });
}

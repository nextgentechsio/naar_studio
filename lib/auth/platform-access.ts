import { NextResponse } from "next/server";
import { canUsePlatform, platformLabel, type PlatformKey } from "@/lib/auth/platforms";

// A 403 for routes that start work on a platform the
// account isn't allowed to use (null = allowed)
export function platformDenied(
  user: { platforms: readonly PlatformKey[] },
  platform: PlatformKey,
): NextResponse | null {
  if (canUsePlatform(user, platform)) return null;
  return NextResponse.json(
    {
      error: `${platformLabel(platform)} isn't turned on for your account. Ask an admin to give you access.`,
      code: "PLATFORM_NOT_ALLOWED",
    },
    { status: 403 },
  );
}

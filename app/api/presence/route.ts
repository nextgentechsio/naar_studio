import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { maybePruneOutputs } from "@/lib/storage/output-retention";
import { recordHeartbeat } from "@/lib/auth/users";

export const runtime = "nodejs";

// Heartbeat from an open, visible app tab (see
// lib/auth/presence.ts). Any signed-in user.
export async function POST() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    await recordHeartbeat(auth.user.id);
    // Hourly cleanup of old saved outputs, after the
    // response so nobody waits for it
    after(maybePruneOutputs);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Presence heartbeat error:", error);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}

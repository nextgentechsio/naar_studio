import { NextResponse } from "next/server";
import { billingSummary, parsePeriod } from "@/lib/api-keys/billing";
import { apiError, requireApiKey } from "@/lib/api-keys/http";

export const runtime = "nodejs";

// GET ?month=2026-11 (this month by default) or
// ?from=2026-11-01&to=2026-11-15: this key's billing for
// the period: total, runs, by platform, model, project
// and day, and (this month) the cap and runs in flight
export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const parsed = parsePeriod(new URL(request.url).searchParams);
  if ("error" in parsed) return apiError("invalid_request", parsed.error, 400);

  try {
    return NextResponse.json(await billingSummary(guard.caller.key, parsed.period));
  } catch (error) {
    console.error("API billing summary error:", error);
    return apiError("server_error", "Couldn't read billing.", 500);
  }
}

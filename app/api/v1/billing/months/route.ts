import { NextResponse } from "next/server";
import { billingMonths } from "@/lib/api-keys/billing";
import { apiError, requireApiKey } from "@/lib/api-keys/http";

export const runtime = "nodejs";

// GET ?count=12 (1 to 36): this key's total for each of
// the last months, newest first, months with no runs
// included at $0
export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const raw = new URL(request.url).searchParams.get("count");
  const count = raw === null ? 12 : Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 36) {
    return apiError("invalid_request", "count must be a whole number from 1 to 36.", 400);
  }

  try {
    return NextResponse.json(await billingMonths(guard.caller.key, count));
  } catch (error) {
    console.error("API billing months error:", error);
    return apiError("server_error", "Couldn't read billing.", 500);
  }
}

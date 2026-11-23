import { NextResponse } from "next/server";
import { listCharges, parsePeriod } from "@/lib/api-keys/billing";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { API_LIVE_PLATFORMS, type ApiKeyPlatform } from "@/lib/api-keys/shared";

export const runtime = "nodejs";

// GET: this key's charges for a period, newest first, one
// per succeeded run. ?month= or ?from=&to=, plus
// ?platform= ?model= ?project= (id), ?limit= (max 200)
// and ?cursor= (nextCursor from the page before)
export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const params = new URL(request.url).searchParams;
  const parsed = parsePeriod(params);
  if ("error" in parsed) return apiError("invalid_request", parsed.error, 400);

  const platform = params.get("platform");
  if (platform && !API_LIVE_PLATFORMS.includes(platform as ApiKeyPlatform)) {
    return apiError("invalid_request", `platform must be one of: ${API_LIVE_PLATFORMS.join(", ")}.`, 400);
  }

  try {
    const { data, nextCursor } = await listCharges(guard.caller.key, parsed.period, {
      limit: Number(params.get("limit")) || 0,
      cursor: params.get("cursor"),
      platform,
      model: params.get("model"),
      project: params.get("project"),
    });
    return NextResponse.json({ object: "list", period: parsed.period.label, data, nextCursor });
  } catch (error) {
    console.error("API billing charges error:", error);
    return apiError("server_error", "Couldn't list charges.", 500);
  }
}

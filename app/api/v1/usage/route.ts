import { NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { capState, isMonthKey, monthKey } from "@/lib/api-keys/shared";
import { keySpend, keySpendBreakdown } from "@/lib/api-keys/spend";

export const runtime = "nodejs";

// GET ?month=2026-11: this key's spend for a month (this
// one by default), its cap and what's left, by model and
// by project
export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;
  const { key } = guard.caller;

  const requested = new URL(request.url).searchParams.get("month");
  if (requested && !isMonthKey(requested)) return apiError("invalid_request", "month must look like 2026-11.", 400);
  const month = requested ?? monthKey();

  try {
    const [spend, breakdown] = await Promise.all([keySpend(key._id, month), keySpendBreakdown(key._id, month)]);
    const cap = key.monthlyCapUsd;
    return NextResponse.json({
      object: "usage",
      key: { id: key._id.toHexString(), name: key.name },
      month,
      spentUsd: spend.amountUsd,
      runs: spend.count,
      inFlight: { runs: spend.inFlight, estimatedUsd: spend.inFlightUsd },
      cap: cap === null ? null : { monthlyUsd: cap, remainingUsd: Math.max(0, cap - spend.amountUsd - spend.inFlightUsd), state: capState(spend, cap) },
      concurrency: key.concurrency,
      byModel: breakdown.byModel,
      byProject: breakdown.byProject,
    });
  } catch (error) {
    console.error("API usage error:", error);
    return apiError("server_error", "Couldn't read usage.", 500);
  }
}

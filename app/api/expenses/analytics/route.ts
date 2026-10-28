import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCostAnalytics, isTimeZone } from "@/lib/cost-analytics";
import { isProvider, type Provider } from "@/lib/mongodb";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
// Longest period one request may cover
const MAX_DAYS = 400;

function instant(value: string | null): Date | null {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

// --------------------------------------------------
// COST ANALYTICS for the Dashboard (lib/cost-analytics.ts)
//
// ?from=&to=        the period (ISO; to is exclusive)
// &monthStart=      the viewer's 1st-of-month midnight
// &tz=              their timezone (IANA), for days
// &provider=        replicate | higgsfield (optional)
// --------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const params = new URL(request.url).searchParams;
  const now = Date.now();

  const to = instant(params.get("to")) ?? new Date(now);
  const from = instant(params.get("from")) ?? new Date(to.getTime() - 30 * DAY_MS);

  if (from >= to || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
    return NextResponse.json({ error: `Choose a period of up to ${MAX_DAYS} days` }, { status: 400 });
  }

  const monthStart =
    instant(params.get("monthStart")) ??
    new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  const tz = params.get("tz");

  try {
    return NextResponse.json(
      await getCostAnalytics(auth.user, {
        from,
        to,
        monthStart,
        timeZone: isTimeZone(tz) ? tz : "UTC",
        provider: isProvider(params.get("provider")) ? (params.get("provider") as Provider) : undefined,
      })
    );
  } catch (error) {
    console.error("Cost analytics error:", error);
    return NextResponse.json({ error: "Couldn't load the cost analytics" }, { status: 500 });
  }
}

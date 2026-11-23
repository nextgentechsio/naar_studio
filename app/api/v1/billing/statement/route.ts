import { NextResponse } from "next/server";
import { allCharges, billingSummary, parsePeriod, statementCsv } from "@/lib/api-keys/billing";
import { apiError, requireApiKey } from "@/lib/api-keys/http";

export const runtime = "nodejs";

// GET ?month= or ?from=&to=, ?format=csv (default) or
// json: every charge in the period, oldest first, as a
// file to keep or invoice from (up to 50,000 charges)
export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;
  const { key } = guard.caller;

  const params = new URL(request.url).searchParams;
  const parsed = parsePeriod(params);
  if ("error" in parsed) return apiError("invalid_request", parsed.error, 400);
  const format = params.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") return apiError("invalid_request", "format must be csv or json.", 400);

  try {
    const { period } = parsed;
    const { data, truncated } = await allCharges(key, period);
    const truncatedHeader = { "X-Statement-Truncated": truncated ? "true" : "false" };

    if (format === "json") {
      const summary = await billingSummary(key, period);
      return NextResponse.json(
        {
          object: "statement",
          key: summary.key,
          period: summary.period,
          currency: "USD",
          totalUsd: summary.totalUsd,
          runs: summary.runs,
          unpricedRuns: summary.unpricedRuns,
          truncated,
          charges: data,
        },
        { headers: truncatedHeader }
      );
    }

    const name = `naar-studio-${key.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "key"}-${period.label.replace("..", "_to_")}.csv`;
    return new NextResponse(statementCsv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        ...truncatedHeader,
      },
    });
  } catch (error) {
    console.error("API billing statement error:", error);
    return apiError("server_error", "Couldn't build the statement.", 500);
  }
}

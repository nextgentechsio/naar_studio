import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { isProvider, type Provider } from "@/lib/db/mongodb";
import { maybePruneOutputs } from "@/lib/storage/output-retention";
import {
  HISTORY_STATUSES,
  listGenerations,
  reconcilePending,
  type HistoryStatus,
} from "@/lib/generations";

export const runtime = "nodejs";

// Generation history for the signed-in user, one page
// at a time. Users get their own records; admins and
// the super admin get everyone's.
//
// ?page=1&pageSize=24&project=<id>&user=<id>
// &model=<owner/name>&status=succeeded|failed|running&q=<text>
// &from=<ISO>&to=<ISO> (created; to is exclusive)
// &provider=replicate|higgsfield
// &options=0 leaves out the filter dropdown values
// An ISO date from the query; anything else is ignored
function instant(value: string | null): Date | undefined {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    // Finish generations whose tab closed mid-way, so
    // their status and cost aren't stuck at "starting".
    // After the response: saving outputs can take minutes,
    // and History re-polls while anything is running.
    const actor = auth.user;
    after(async () => {
      try {
        await reconcilePending(actor);
      } catch (reconcileError) {
        console.error(
          "Reconcile pending generations error:",
          reconcileError
        );
      }
    });

    // Hourly cleanup of old saved outputs, after the
    // response so nobody waits for it
    after(maybePruneOutputs);

    const params = new URL(request.url).searchParams;
    const status = params.get("status");

    return NextResponse.json(
      await listGenerations(auth.user, {
        page: Number(params.get("page")) || 1,
        pageSize: Number(params.get("pageSize")) || 24,
        projectId: params.get("project") || undefined,
        userId: params.get("user") || undefined,
        model: params.get("model") || undefined,
        status: HISTORY_STATUSES.includes(status as HistoryStatus)
          ? (status as HistoryStatus)
          : undefined,
        q: params.get("q") || undefined,
        provider: isProvider(params.get("provider")) ? (params.get("provider") as Provider) : undefined,
        createdFrom: instant(params.get("from")),
        createdTo: instant(params.get("to")),
        withOptions: params.get("options") !== "0",
      })
    );
  } catch (error) {
    console.error("List generations error:", error);

    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 }
    );
  }
}

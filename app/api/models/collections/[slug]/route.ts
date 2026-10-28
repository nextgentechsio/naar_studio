import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateHeaders,
  upstreamStatus,
} from "@/lib/replicate/api";
import {
  COLLECTION_SLUG,
  cached,
  sortModels,
  toBrowsable,
  type BrowsableModel,
} from "@/lib/replicate/models";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`Replicate responded ${status}`);
  }
}

// The models in one Replicate collection, most used first
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const { slug } = await context.params;

  // Interpolated into a Replicate URL that carries our token
  if (!COLLECTION_SLUG.test(slug)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  const headers = replicateHeaders();
  if (!headers) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  try {
    const models = await cached(`collection:${slug}`, async () => {
      const response = await fetch(
        replicateApiUrl(`collections/${encodeURIComponent(slug)}`),
        { headers, cache: "no-store" }
      );
      if (!response.ok) throw new UpstreamError(response.status);

      const data = await readReplicateJson(response);
      const list = Array.isArray(data.models) ? data.models : [];

      return sortModels(
        list.map(toBrowsable).filter((model): model is BrowsableModel => model !== null)
      );
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.error("Collection models error:", slug, error);

    return NextResponse.json(
      { error: "Couldn't load this category" },
      { status: error instanceof UpstreamError ? upstreamStatus(error.status) : 500 }
    );
  }
}

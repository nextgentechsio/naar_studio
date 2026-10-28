import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateHeaders,
  upstreamStatus,
} from "@/lib/replicate/api";
import { cached } from "@/lib/replicate/models";

export const runtime = "nodejs";

type Collection = { slug: string; name: string; description: string | null };

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`Replicate responded ${status}`);
  }
}

// Replicate's curated model collections ("Official",
// "Text to image", "Upscale images", …) for browsing
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const headers = replicateHeaders();
  if (!headers) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  try {
    const collections = await cached("collections", async () => {
      const response = await fetch(replicateApiUrl("collections"), {
        headers,
        cache: "no-store",
      });
      if (!response.ok) throw new UpstreamError(response.status);

      const data = await readReplicateJson(response);
      const results = Array.isArray(data.results) ? data.results : [];

      return results
        .filter(
          (item): item is { slug: string; name: string; description?: unknown } =>
            typeof item?.slug === "string" && typeof item?.name === "string"
        )
        .map(
          (item): Collection => ({
            slug: item.slug,
            name: item.name,
            description:
              typeof item.description === "string"
                ? item.description.slice(0, 200)
                : null,
          })
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    return NextResponse.json({ collections });
  } catch (error) {
    console.error("Collections error:", error);

    return NextResponse.json(
      { error: "Couldn't load model categories" },
      { status: error instanceof UpstreamError ? upstreamStatus(error.status) : 500 }
    );
  }
}

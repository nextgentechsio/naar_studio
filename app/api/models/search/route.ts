import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  upstreamStatus,
} from "@/lib/replicate/api";

import {
  sortModels,
  toBrowsable,
  type BrowsableModel,
} from "@/lib/replicate/models";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "Replicate API token is missing" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim().slice(0, 100);

    if (!query) {
      return NextResponse.json({
        models: [],
      });
    }

    const replicateUrl =
      replicateApiUrl("search") +
      "?" +
      new URLSearchParams({
        query,
        limit: "50",
      }).toString();

    const response = await fetch(replicateUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data = await readReplicateJson(response);

    if (!response.ok) {
      return NextResponse.json(
        { error: replicateErrorMessage(data, "Replicate search failed") },
        { status: upstreamStatus(response.status) }
      );
    }

    const items = Array.isArray(data.models) ? data.models : [];

    // Search items wrap the model: { model, metadata }
    const models = sortModels(
      items
        .map((item: { model?: unknown }) => toBrowsable(item?.model ?? item))
        .filter((model): model is BrowsableModel => model !== null)
    );

    return NextResponse.json({
      query,
      models,
    });
  } catch (error) {
    console.error("Replicate search error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
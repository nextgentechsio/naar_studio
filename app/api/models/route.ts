import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import { replicateApiUrl, upstreamStatus } from "@/lib/replicate/api";

type ReplicateModel = {
  owner: string;
  name: string;
  description?: string | null;
  url?: string | null;
  is_official?: boolean;
};

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
    const search = (searchParams.get("search") ?? "").trim().slice(0, 100);

    let url = replicateApiUrl("models");

    if (search) {
      url += `?${new URLSearchParams({
        query: search,
      }).toString()}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data: {
      results?: ReplicateModel[];
      next?: string | null;
      previous?: string | null;
    } = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch Replicate models" },
        { status: upstreamStatus(response.status) }
      );
    }

    const models = (data.results ?? []).map((model) => ({
      id: `${model.owner}/${model.name}`,
      owner: model.owner,
      name: model.name,
      displayName: model.name,
      description: model.description ?? null,
      url: model.url ?? null,
      isOfficial: model.is_official ?? false,
    }));

    return NextResponse.json({
      models,
      next: data.next ?? null,
      previous: data.previous ?? null,
    });
  } catch (error) {
    console.error("Models API error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
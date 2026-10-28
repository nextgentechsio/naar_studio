import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/auth";
import {
  readReplicateJson,
  replicateApiUrl,
  replicateErrorMessage,
  upstreamStatus,
} from "@/lib/replicate/api";
import {
  isValidModelId,
  modelPath,
} from "@/lib/replicate/model";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get("model");

    if (!model) {
      return NextResponse.json(
        { error: "Model is required" },
        { status: 400 }
      );
    }

    if (!isValidModelId(model)) {
      return NextResponse.json(
        { error: "Invalid model ID" },
        { status: 400 }
      );
    }

    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: "Replicate API token is missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      replicateApiUrl(`models/${modelPath(model)}`),
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await readReplicateJson(response);

    if (!response.ok) {
      return NextResponse.json(
        { error: replicateErrorMessage(data, "Failed to fetch model schema") },
        { status: upstreamStatus(response.status) }
      );
    }

    const openapiSchema = data.latest_version?.openapi_schema;

    const properties: Record<string, Record<string, unknown>> =
      openapiSchema?.components?.schemas?.Input?.properties || {};

    const components: Record<string, Record<string, unknown>> =
      openapiSchema?.components?.schemas || {};

    // Enums are referenced via allOf: [{ $ref }]; inline them
    const inputSchema = Object.fromEntries(
      Object.entries(properties).map(([key, field]) => {
        const ref = (field?.allOf as { $ref?: string }[] | undefined)?.[0]
          ?.$ref;
        const referenced = ref ? components[ref.split("/").pop() ?? ""] : null;

        return [key, referenced ? { ...referenced, ...field } : field];
      })
    );

    return NextResponse.json({
      model: `${data.owner}/${data.name}`,
      description: data.description,
      inputSchema,
    });
  } catch (error) {
    console.error("Schema API error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";
import { apiError, requireApiKey } from "@/lib/api-keys/http";
import { API_LIVE_PLATFORMS, type ApiKeyPlatform } from "@/lib/api-keys/shared";
import { listVoices } from "@/lib/elevenlabs/client";
import { ELEVENLABS_MODELS, elevenLabsModelInfo, elevenLabsPriceHint, elevenLabsSchema, findElevenLabsModel } from "@/lib/elevenlabs/models";
import { findHiggsfieldModel, formSchema, listHiggsfieldModels } from "@/lib/higgsfield/client";
import { higgsfieldPriceHint } from "@/lib/higgsfield/models";
import { MODEL_IDS } from "@/lib/replicate/cost";
import { readReplicateJson, replicateApiUrl, replicateHeaders } from "@/lib/replicate/api";
import { inputSchemaFromModel } from "@/lib/replicate/inputs";
import { isValidModelId, modelPath } from "@/lib/replicate/model";

export const runtime = "nodejs";

// --------------------------------------------------
// GET the models this key may run.
//   ?platform=replicate|higgsfield|elevenlabs (default:
//     every platform the key has) lists them: for
//     Replicate the priced ones (any public Replicate
//     model id is accepted on a start), for the others
//     their whole list.
//   ?model=<id>&platform=<p> gives one model's input
//     schema (platform defaults to replicate).
// --------------------------------------------------

export async function GET(request: Request) {
  const guard = await requireApiKey(request);
  if (guard.response) return guard.response;

  const allowed = API_LIVE_PLATFORMS.filter((platform) => guard.caller.key.platforms.includes(platform));
  const params = new URL(request.url).searchParams;
  const model = params.get("model");
  const requested = params.get("platform");
  if (requested && !API_LIVE_PLATFORMS.includes(requested as ApiKeyPlatform)) {
    return apiError("invalid_request", `platform must be one of: ${API_LIVE_PLATFORMS.join(", ")}.`, 400);
  }

  try {
    if (!model) {
      const platforms = requested ? allowed.filter((platform) => platform === requested) : allowed;
      if (requested && !platforms.length) return apiError("platform_not_allowed", `This key can't use ${requested}.`, 403);
      const lists = await Promise.all(platforms.map(listFor));
      return NextResponse.json({ object: "list", platforms: allowed, data: lists.flat() });
    }

    const platform = (requested ?? "replicate") as ApiKeyPlatform;
    if (!allowed.includes(platform)) return apiError("platform_not_allowed", `This key can't use ${platform}.`, 403);
    const one = await describe(platform, model);
    if (!one) return apiError("model_not_found", "No such model on that platform.", 404);
    if (isFailure(one)) return apiError(one.code, one.error, one.status);
    return NextResponse.json(one);
  } catch (error) {
    console.error("API models error:", error);
    return apiError("server_error", "Couldn't list models.", 500);
  }
}

type Listed = { id: string; platform: ApiKeyPlatform; title?: string; description?: string; output?: string; price?: string | null; priced?: boolean };

async function listFor(platform: ApiKeyPlatform): Promise<Listed[]> {
  switch (platform) {
    case "replicate":
      return [...new Set(Object.values(MODEL_IDS))].map((id) => ({ id, platform, priced: true }));
    case "higgsfield":
      return (await listHiggsfieldModels()).map((item) => ({
        id: item.id,
        platform,
        title: item.title,
        description: item.description,
        output: item.output,
        price: higgsfieldPriceHint(item.id),
      }));
    case "elevenlabs":
      return ELEVENLABS_MODELS.map((item) => {
        const info = elevenLabsModelInfo(item);
        return { id: info.id, platform, title: `${info.title} · ${info.task}`, description: info.description, output: "audio", price: elevenLabsPriceHint(info.id) };
      });
  }
}

type Failure = { error: string; code: string; status: number };
type Described = Record<string, unknown> | Failure | null;

const isFailure = (value: Record<string, unknown> | Failure): value is Failure =>
  typeof value.error === "string" && typeof value.code === "string";

async function describe(platform: ApiKeyPlatform, model: string): Promise<Described> {
  switch (platform) {
    case "replicate": {
      if (!isValidModelId(model)) return { error: "model must look like owner/name.", code: "invalid_request", status: 400 };
      const headers = replicateHeaders();
      if (!headers) return { error: "Replicate isn't configured on the server.", code: "server_error", status: 500 };
      const response = await fetch(replicateApiUrl(`models/${modelPath(model)}`), { headers, cache: "no-store" });
      const data = await readReplicateJson(response);
      if (response.status === 404) return null;
      if (!response.ok) return { error: "Couldn't fetch that model.", code: "provider_error", status: 502 };
      return {
        id: model,
        platform,
        description: typeof data.description === "string" ? data.description : null,
        priced: (Object.values(MODEL_IDS) as string[]).includes(model),
        inputSchema: inputSchemaFromModel(data),
      };
    }
    case "higgsfield": {
      const raw = await findHiggsfieldModel(model);
      if (!raw) return null;
      return { id: model, platform, title: raw.title ?? model, description: raw.description ?? null, price: higgsfieldPriceHint(model), inputSchema: formSchema(raw) };
    }
    case "elevenlabs": {
      const item = findElevenLabsModel(model);
      if (!item) return null;
      const voices = item.tool === "tts" || item.tool === "voice-changer" ? await listVoices().catch(() => []) : [];
      return { id: model, platform, title: `${item.title} · ${item.task}`, description: item.description, price: elevenLabsPriceHint(model), inputSchema: elevenLabsSchema(item, voices) };
    }
  }
}

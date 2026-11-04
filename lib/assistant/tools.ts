import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { StoredUser } from "@/lib/auth/users";
import { listElements } from "@/lib/elements";
import { elevenLabsCostUsd, elevenLabsPriceHint, ELEVENLABS_MODELS, findElevenLabsModel } from "@/lib/elevenlabs/models";
import { listGenerations } from "@/lib/generations";
import {
  findHiggsfieldModel,
  formSchema,
  higgsfieldConfigured,
  listHiggsfieldModels,
  quoteHiggsfield,
  shapeHiggsfieldInputs,
} from "@/lib/higgsfield/client";
import { approxMeteredCostUsd, higgsfieldPriceHint, higgsfieldPriceKind } from "@/lib/higgsfield/models";
import { listProjects } from "@/lib/projects";
import { readReplicateJson, replicateApiUrl } from "@/lib/replicate/api";
import { MODEL_CATALOG } from "@/lib/replicate/catalog";
import { calculateReplicateCost } from "@/lib/replicate/cost";
import { isValidModelId, modelPath } from "@/lib/replicate/model";

// --------------------------------------------------
// ASSISTANT TOOLS (read only)
//
// What Claude can look up for the signed-in user, by
// calling the app's own functions with that user's
// rights: projects, models and their settings, prices,
// their history and elements. Nothing here starts a run
// or spends money.
// Each tool: a JSON schema for Claude, a zod schema that
// checks what Claude sent, and run().
// --------------------------------------------------

export type ToolContext = { user: StoredUser };

type AssistantTool = {
  definition: Anthropic.Beta.BetaTool;
  input: z.ZodType;
  run: (input: never, context: ToolContext) => Promise<unknown>;
};

const PLATFORMS = ["replicate", "higgsfield", "elevenlabs"] as const;
const OUTPUTS = ["image", "video", "audio"] as const;

const clip = (text: string | undefined, max: number) =>
  !text ? "" : text.length > max ? `${text.slice(0, max - 1)}…` : text;

const words = (query: string | undefined) =>
  (query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const matchesAll = (haystack: string, terms: string[]) => {
  const text = haystack.toLowerCase();
  return terms.every((term) => text.includes(term));
};

function tool<T extends z.ZodType>(
  name: string,
  description: string,
  input: T,
  inputSchema: Anthropic.Beta.BetaTool["input_schema"],
  run: (input: z.infer<T>, context: ToolContext) => Promise<unknown>,
): AssistantTool {
  return {
    // Large inputs stream as they're written; each is
    // checked against `input` before it runs
    definition: { name, description, input_schema: inputSchema, eager_input_streaming: true },
    input,
    run: run as AssistantTool["run"],
  };
}

// ---------- Models ----------

type ModelRow = {
  platform: (typeof PLATFORMS)[number];
  model: string;
  name: string;
  output: (typeof OUTPUTS)[number];
  summary: string;
  price: string | null;
};

async function allModels(): Promise<ModelRow[]> {
  const replicate: ModelRow[] = MODEL_CATALOG.map((item) => ({
    platform: "replicate",
    model: item.id,
    name: `${item.label} (${item.vendor})`,
    output: item.kind === "video" || (item.kind === "upscale" && item.id.includes("video")) ? "video" : "image",
    summary: item.summary,
    price: item.priceHint,
  }));

  const higgsfield: ModelRow[] = higgsfieldConfigured()
    ? (await listHiggsfieldModels().catch(() => [])).map((item) => ({
        platform: "higgsfield",
        model: item.id,
        name: `${item.title} · ${item.task}`,
        output: item.output,
        summary: clip(item.description, 160),
        price:
          higgsfieldPriceHint(item.id) ??
          (higgsfieldPriceKind(item.id) === "unreported" ? "Not reported by Higgsfield" : "Quoted per run"),
      }))
    : [];

  const elevenlabs: ModelRow[] = ELEVENLABS_MODELS.map((item) => ({
    platform: "elevenlabs",
    model: item.id,
    name: `${item.title} · ${item.task}`,
    output: "audio",
    summary: item.description,
    price: elevenLabsPriceHint(item.id),
  }));

  return [...replicate, ...higgsfield, ...elevenlabs];
}

type Field = {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  required?: boolean;
};

function describeFields(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, Field> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, field]) => [
      key,
      {
        type: typeof field.type === "string" ? field.type : undefined,
        description: clip(typeof field.description === "string" ? field.description : undefined, 220) || undefined,
        enum: Array.isArray(field.enum) ? field.enum.slice(0, 40) : undefined,
        default: field.default ?? undefined,
        minimum: typeof field.minimum === "number" ? field.minimum : undefined,
        maximum: typeof field.maximum === "number" ? field.maximum : undefined,
        required: required.includes(key) || undefined,
      },
    ]),
  );
}

async function replicateFields(model: string) {
  if (!isValidModelId(model)) throw new Error(`"${model}" isn't a Replicate model id (owner/name)`);
  const response = await fetch(replicateApiUrl(`models/${modelPath(model)}`), {
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN ?? ""}` },
    cache: "no-store",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await readReplicateJson(response);
  if (!response.ok) throw new Error(`Replicate couldn't describe ${model} (${response.status})`);

  const schemas = data?.latest_version?.openapi_schema?.components?.schemas ?? {};
  const input = schemas.Input ?? {};
  // Enums are referenced via allOf: [{ $ref }]; inline them
  const properties = Object.fromEntries(
    Object.entries((input.properties ?? {}) as Record<string, Record<string, unknown>>).map(([key, field]) => {
      const ref = (field.allOf as { $ref?: string }[] | undefined)?.[0]?.$ref;
      const referenced = ref ? schemas[ref.split("/").pop() ?? ""] : null;
      return [key, referenced ? { ...referenced, ...field } : field];
    }),
  );
  return { description: clip(data?.description, 300), fields: describeFields(properties, input.required ?? []) };
}

// ---------- The tools ----------

export const TOOLS: AssistantTool[] = [
  tool(
    "list_projects",
    "List the studio's active projects (every run belongs to one). Use it before suggesting where work goes.",
    z.object({}),
    { type: "object", properties: {}, additionalProperties: false },
    async () => (await listProjects()).map((project) => ({ name: project.name, description: clip(project.description, 160) })),
  ),

  tool(
    "find_models",
    "Search the generation models available in the studio across Replicate, Higgsfield and ElevenLabs, with price hints. Leave query empty to list everything for a platform or output type.",
    z.object({
      query: z.string().max(200).optional(),
      platform: z.enum(PLATFORMS).optional(),
      output: z.enum(OUTPUTS).optional(),
    }),
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to match in the model's name or description, e.g. 'seedance', 'upscale', 'voice'" },
        platform: { type: "string", enum: [...PLATFORMS] },
        output: { type: "string", enum: [...OUTPUTS], description: "What the model makes" },
      },
      additionalProperties: false,
    },
    async (input) => {
      const terms = words(input.query);
      const rows = (await allModels()).filter(
        (row) =>
          (!input.platform || row.platform === input.platform) &&
          (!input.output || row.output === input.output) &&
          matchesAll(`${row.name} ${row.model} ${row.summary}`, terms),
      );
      return { total: rows.length, models: rows.slice(0, 30) };
    },
  ),

  tool(
    "model_details",
    "The settings a model takes (names, types, allowed values, defaults, which are required) and its price hint. Read this before proposing inputs for a run.",
    z.object({ platform: z.enum(PLATFORMS), model: z.string().min(1).max(200) }),
    {
      type: "object",
      properties: {
        platform: { type: "string", enum: [...PLATFORMS] },
        model: { type: "string", description: "The model id from find_models" },
      },
      required: ["platform", "model"],
      additionalProperties: false,
    },
    async ({ platform, model }) => {
      if (platform === "higgsfield") {
        const raw = await findHiggsfieldModel(model);
        if (!raw) throw new Error(`No Higgsfield model "${model}"`);
        return {
          model,
          description: clip(raw.description, 300),
          price: higgsfieldPriceHint(model) ?? "Quoted per run (use estimate_cost)",
          fields: describeFields(formSchema(raw) as Record<string, Record<string, unknown>>, raw.input_schema?.required ?? []),
        };
      }
      if (platform === "elevenlabs") {
        const item = findElevenLabsModel(model);
        if (!item) throw new Error(`No ElevenLabs model "${model}"`);
        return {
          model,
          description: item.description,
          price: elevenLabsPriceHint(model),
          fields:
            item.tool === "tts"
              ? { prompt: { type: "string", description: "The text to speak", required: true }, voice_id: { type: "string", required: true } }
              : item.tool === "voice-changer"
                ? { audio: { type: "string", description: "Recording to re-voice", required: true }, voice_id: { type: "string", required: true } }
                : { prompt: { type: "string", description: "What to make", required: true }, duration: { type: "number", description: "Seconds" } },
        };
      }
      const catalog = MODEL_CATALOG.find((item) => item.id === model);
      return { model, price: catalog?.priceHint ?? "Not in the studio's price table", ...(await replicateFields(model)) };
    },
  ),

  tool(
    "estimate_cost",
    "What a run would cost with these inputs, before running it. Free: nothing runs. 'exact' says whether it's the final price or an estimate.",
    z.object({
      platform: z.enum(PLATFORMS),
      model: z.string().min(1).max(200),
      inputs: z.record(z.string(), z.unknown()),
    }),
    {
      type: "object",
      properties: {
        platform: { type: "string", enum: [...PLATFORMS] },
        model: { type: "string" },
        inputs: { type: "object", description: "The run's settings, as model_details names them", additionalProperties: true },
      },
      required: ["platform", "model", "inputs"],
      additionalProperties: false,
    },
    async ({ platform, model, inputs }) => {
      if (platform === "replicate") {
        const usd = calculateReplicateCost(model, { status: "succeeded", input: inputs });
        return usd === null
          ? { usd: null, note: "No price for this model or these inputs (e.g. a video's length isn't known yet)" }
          : { usd: Math.round(usd * 10_000) / 10_000, exact: false, note: "From the studio's Replicate price table" };
      }
      if (platform === "elevenlabs") {
        const usd = elevenLabsCostUsd(model, inputs);
        return usd === null ? { usd: null, note: "Priced by the length made; give a duration" } : { usd, exact: false };
      }
      const kind = higgsfieldPriceKind(model);
      if (kind === "unreported") return { usd: null, note: "Higgsfield doesn't report this model's price" };
      if (kind === "metered") {
        const usd = approxMeteredCostUsd(model, inputs);
        return usd === null ? { usd: null, note: "Give a duration to price it" } : { usd, exact: false, note: "Measured after the run" };
      }
      const raw = await findHiggsfieldModel(model);
      if (!raw) throw new Error(`No Higgsfield model "${model}"`);
      const usd = await quoteHiggsfield(model, shapeHiggsfieldInputs(raw, inputs));
      return usd === null ? { usd: null, note: "Higgsfield couldn't quote these inputs" } : { usd, exact: true, note: "Higgsfield's quote" };
    },
  ),

  tool(
    "search_history",
    "Search the user's past runs (the History page): prompt words, project, status or output kind. Managers see their team's runs too.",
    z.object({
      query: z.string().max(200).optional(),
      project: z.string().max(200).optional(),
      status: z.enum(["succeeded", "failed", "running"]).optional(),
      output: z.enum(OUTPUTS).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the prompt" },
        project: { type: "string", description: "Project name" },
        status: { type: "string", enum: ["succeeded", "failed", "running"] },
        output: { type: "string", enum: [...OUTPUTS] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    async (input, { user }) => {
      let projectId: string | undefined;
      if (input.project) {
        const wanted = input.project.trim().toLowerCase();
        projectId = (await listProjects({ includeArchived: true })).find((project) => project.name.toLowerCase() === wanted)?.id;
        if (!projectId) return { total: 0, runs: [], note: `No project named "${input.project}"` };
      }
      const page = await listGenerations(user, {
        q: input.query,
        projectId,
        status: input.status,
        outputKind: input.output,
        pageSize: input.limit ?? 10,
      });
      return {
        total: page.total,
        runs: page.generations.map((run) => ({
          id: run.id,
          model: run.model,
          project: run.project,
          by: run.user,
          status: run.status,
          prompt: clip(run.prompt, 200),
          costUsd: run.costUsd,
          output: run.outputUrl,
          createdAt: run.createdAt,
        })),
      };
    },
  ),

  tool(
    "list_elements",
    "The user's saved elements (named characters, products or places with reference images, used as @name in prompts).",
    z.object({ query: z.string().max(200).optional() }),
    {
      type: "object",
      properties: { query: { type: "string", description: "Words in the element's name or description" } },
      additionalProperties: false,
    },
    async ({ query }, { user }) => {
      const terms = words(query);
      return (await listElements(user.id))
        .filter((element) => matchesAll(`${element.name} ${element.description}`, terms))
        .slice(0, 30)
        .map((element) => ({
          name: `@${element.name}`,
          description: clip(element.description, 200),
          images: element.images.length,
          videos: element.videos.length,
          audios: element.audios.length,
          firstImage: element.images[0] ?? null,
        }));
    },
  ),
];

export const TOOL_DEFINITIONS = TOOLS.map((item) => item.definition);

// Results longer than this are cut (they'd fill the
// conversation and cost tokens on every later turn)
const RESULT_MAX = 16_000;

// Runs one tool call. Never throws: a bad input or a
// failure comes back as an error result for Claude to
// read and recover from.
export async function runTool(
  name: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<{ ok: boolean; content: string; summary: string }> {
  const item = TOOLS.find((candidate) => candidate.definition.name === name);
  if (!item) return { ok: false, content: `Unknown tool "${name}"`, summary: "Unknown tool" };

  const parsed = item.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      content: `Invalid input: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`,
      summary: "Invalid input",
    };
  }

  try {
    const result = await item.run(parsed.data as never, context);
    const text = JSON.stringify(result);
    return {
      ok: true,
      content: text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}… (cut)` : text,
      summary: summarize(name, result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "It failed";
    return { ok: false, content: message, summary: message };
  }
}

// One line for the activity row
function summarize(name: string, result: unknown): string {
  const data = result as Record<string, unknown> | unknown[];
  if (Array.isArray(data)) return `${data.length} found`;
  if (name === "find_models" || name === "search_history") return `${(data as { total: number }).total} found`;
  if (name === "estimate_cost") {
    const usd = (data as { usd: number | null }).usd;
    return usd === null ? "No price" : `≈ $${usd.toFixed(usd < 1 ? 3 : 2)}`;
  }
  if (name === "model_details") return `${Object.keys((data as { fields?: object }).fields ?? {}).length} settings`;
  return "Done";
}

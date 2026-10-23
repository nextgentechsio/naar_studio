import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  findHiggsfieldModel,
  higgsfieldConfigured,
  quoteHiggsfield,
  shapeHiggsfieldInputs,
} from "@/lib/higgsfield";
import { approxMeteredCostUsd, higgsfieldPriceKind } from "@/lib/higgsfield-models";

export const runtime = "nodejs";

// --------------------------------------------------
// PRICE OF A HIGGSFIELD RUN, BEFORE RUNNING IT
//
// POST { model, inputs } → { kind, costUsd }. Quoted
// models: Higgsfield's exact price for these inputs.
// Metered ones: a 16:9 estimate (the exact cost is
// measured after the run). Free: nothing runs.
// --------------------------------------------------

const MAX_INPUT_BYTES = 100_000;
const PLACEHOLDER_URL = "https://example.com/placeholder.png";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const { model, inputs } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof model !== "string" ||
    !model ||
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs) ||
    JSON.stringify(inputs).length > MAX_INPUT_BYTES
  ) {
    return NextResponse.json({ error: "Model and inputs are required" }, { status: 400 });
  }

  const kind = higgsfieldPriceKind(model);

  if (!higgsfieldConfigured()) {
    return NextResponse.json({ kind, costUsd: null });
  }

  const modelRecord = await findHiggsfieldModel(model).catch(() => null);
  if (!modelRecord) {
    return NextResponse.json({ error: "Unknown Higgsfield model" }, { status: 404 });
  }

  const input = shapeHiggsfieldInputs(modelRecord, inputs as Record<string, unknown>);

  if (kind === "metered") {
    return NextResponse.json({ kind, costUsd: approxMeteredCostUsd(model, input) });
  }
  if (kind === "unreported") {
    return NextResponse.json({ kind, costUsd: null });
  }

  // Required settings not filled in yet (the prompt, an
  // image still to upload) don't change the price; stand-ins
  // let Higgsfield quote the rest
  const schema = modelRecord.input_schema;
  for (const key of schema?.required ?? []) {
    const value = input[key];
    if (value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)) continue;

    const field = schema?.properties?.[key];
    const type = Array.isArray(field?.type) ? field.type.find((item) => item !== "null") : field?.type;
    const isFile = /url|image|video|audio|frame/i.test(key);

    if (type === "array") input[key] = [isFile ? PLACEHOLDER_URL : "x"];
    else if (type === "string") input[key] = isFile ? PLACEHOLDER_URL : "x";
  }

  return NextResponse.json({ kind, costUsd: await quoteHiggsfield(model, input) });
}

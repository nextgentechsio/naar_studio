// --------------------------------------------------
// INPUT SHAPING (server side, before a prediction)
//
// The form keeps uploads as lists and every field as a
// string or default. Replicate validates strictly, so
// each value is shaped to what the model's own schema
// says: one URL vs a list, numbers as numbers, and
// optional fields left empty are not sent at all.
// --------------------------------------------------

export type InputProperty = {
  type?: string;
  format?: string;
  items?: { type?: string };
};

export type InputSchema = {
  properties: Record<string, InputProperty>;
  required: string[];
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Input properties from a Replicate model response,
// resolving `allOf: [{ $ref }]` (used for enums)
export function inputSchemaFromModel(model: unknown): InputSchema | null {
  if (!isObject(model)) return null;

  const openapi = (model.latest_version as Json | undefined)?.openapi_schema;
  const schemas = isObject(openapi)
    ? ((openapi.components as Json | undefined)?.schemas as Json | undefined)
    : undefined;
  const input = schemas?.Input;

  if (!isObject(input) || !isObject(input.properties)) return null;

  const properties: Record<string, InputProperty> = {};

  for (const [key, raw] of Object.entries(input.properties)) {
    if (!isObject(raw)) continue;

    let field: Json = raw;
    const ref = (raw.allOf as Json[] | undefined)?.[0]?.$ref;

    if (typeof ref === "string") {
      const referenced = schemas?.[ref.split("/").pop() ?? ""];
      if (isObject(referenced)) field = { ...referenced, ...raw };
    }

    properties[key] = {
      type: typeof field.type === "string" ? field.type : undefined,
      format: typeof field.format === "string" ? field.format : undefined,
      items: isObject(field.items)
        ? { type: String(field.items.type ?? "") || undefined }
        : undefined,
    };
  }

  return {
    properties,
    required: Array.isArray(input.required)
      ? input.required.filter((key): key is string => typeof key === "string")
      : [],
  };
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

// Fields that always hold one URL, whatever the schema
const SINGLE_URL_FIELDS = ["start_image", "end_image", "reference_video"];
// Fields that always hold a list of URLs
const URL_LIST_FIELDS = ["reference_images"];

export function shapeInputs(raw: Json, schema: InputSchema | null): Json {
  const inputs: Json = { ...raw };

  // ---------- Known media fields ----------

  for (const key of SINGLE_URL_FIELDS) {
    if (!(key in inputs)) continue;

    const value = inputs[key];
    const url = Array.isArray(value) ? value.find(isHttpUrl) : value;

    if (isHttpUrl(url)) inputs[key] = url.trim();
    else delete inputs[key];
  }

  for (const key of URL_LIST_FIELDS) {
    if (!(key in inputs)) continue;

    const value = inputs[key];
    const urls = (Array.isArray(value) ? value : [value]).filter(isHttpUrl);

    if (urls.length) inputs[key] = urls;
    else delete inputs[key];
  }

  // ---------- Kling multi_prompt must be JSON ----------

  if (typeof inputs.multi_prompt === "string") {
    const value = inputs.multi_prompt.trim();

    if (!value) {
      delete inputs.multi_prompt;
    } else {
      try {
        JSON.parse(value);
        inputs.multi_prompt = value;
      } catch {
        inputs.multi_prompt = JSON.stringify([
          { prompt: value, duration: Number(inputs.duration) || 5 },
        ]);
      }
    }
  }

  // ---------- Everything else, by the model's schema ----------

  if (!schema) return inputs;

  for (const [key, value] of Object.entries(inputs)) {
    const property = schema.properties[key];
    if (!property) continue;

    // Optional and left blank: let the model use its default
    if (isEmpty(value) && !schema.required.includes(key)) {
      delete inputs[key];
      continue;
    }

    if (property.type === "array" && !Array.isArray(value) && !isEmpty(value)) {
      inputs[key] = [value];
    } else if (property.type === "string" && Array.isArray(value)) {
      // e.g. an upscaler's single `image`, uploaded as a list
      const first = value.find((item) => typeof item === "string");
      if (first === undefined) delete inputs[key];
      else inputs[key] = first;
    } else if (
      (property.type === "integer" || property.type === "number") &&
      typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
    ) {
      inputs[key] = Number(value);
    }
  }

  return inputs;
}

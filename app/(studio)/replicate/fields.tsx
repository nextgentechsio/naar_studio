// --------------------------------------------------
// GENERATE FORM: schema types and field helpers
// --------------------------------------------------

export type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  "x-order"?: number;
};

export type Schema = Record<string, SchemaProperty>;

export const ASPECT_RATIOS = [
  "match_input_image",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
];

// Uncontrolled so typing never loses focus on re-render;
// remount it (via `key`) when its value must reset.
export function StableTextArea({
  value,
  onChange,
  rows = 6,
  ...props
}: Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "defaultValue"
> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      {...props}
      rows={rows}
      defaultValue={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

export type FileKind = "image" | "video" | "audio";

function isScalarField(field: SchemaProperty) {
  return (
    Boolean(field.enum?.length) ||
    field.type === "boolean" ||
    field.type === "number" ||
    field.type === "integer"
  );
}

// Upload fields, judged by name/format
export function fileKind(
  key: string,
  field: SchemaProperty
): FileKind | null {
  if (isScalarField(field)) return null;

  const lower = key.toLowerCase();

  if (lower.includes("video") && !lower.includes("reference_type")) {
    return "video";
  }

  if (lower.includes("audio")) return "audio";

  if (lower.includes("image") || field.format === "uri") {
    return "image";
  }

  return null;
}

// Tuning knobs most people never touch. Cost-relevant
// inputs (duration, resolution, quality, audio, fps)
// deliberately stay visible.
const ADVANCED_FIELD =
  /seed|guidance|steps|cfg|strength|safety|output_format|output_quality|negative|disable_|enable_|go_fast|lora|sampler|scheduler|megapixels/i;

export function fieldGroup(
  key: string,
  field: SchemaProperty
): "media" | "main" | "advanced" {
  if (fileKind(key, field)) return "media";
  if (ADVANCED_FIELD.test(key)) return "advanced";
  return "main";
}

export function fieldLabel(key: string, field: SchemaProperty) {
  return (
    field.title ||
    key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

// Fields rendered by the generic renderer; prompt,
// aspect ratio and resolution get dedicated controls.
export function orderSchemaFields(
  schema: Schema
): [string, SchemaProperty][] {
  return Object.entries(schema)
    .filter(([key]) => {
      const lower = key.toLowerCase();

      return (
        lower !== "prompt" &&
        lower !== "aspect_ratio" &&
        lower !== "resolution" &&
        !lower.includes("safety_filter")
      );
    })
    .sort(
      ([, first], [, second]) =>
        (first["x-order"] ?? 999) - (second["x-order"] ?? 999)
    );
}

// Initial form values from the model's schema
export function schemaDefaults(
  model: string,
  schema: Schema
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    } else if (field.type === "boolean") {
      defaults[key] = false;
    } else if (field.enum?.length) {
      defaults[key] = field.enum[0];
    } else {
      defaults[key] = "";
    }
  }

  // Common image-model defaults
  if (model === "google/nano-banana-2") {
    defaults.aspect_ratio = defaults.aspect_ratio || "match_input_image";
    defaults.resolution = defaults.resolution || "2K";
  }

  return defaults;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [value];
}

// Shape the form values into what Replicate expects
// (single URL vs array per field). Shared by Generate
// and the cost preview so the estimate prices exactly
// what will be sent.
export function buildGenerationInputs(
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const shaped: Record<string, unknown> = { ...inputs };

  // Arrays: image inputs and reference images
  for (const key of ["image_input", "reference_images"]) {
    if (inputs[key]) shaped[key] = asArray(inputs[key]);
  }

  // Single URLs: optional start/end image, reference
  // video. An uploaded list becomes its first file.
  for (const key of ["start_image", "end_image", "reference_video"]) {
    const value = inputs[key];

    if (Array.isArray(value) && value.length > 0) {
      shaped[key] = value[0];
    }
  }

  return shaped;
}

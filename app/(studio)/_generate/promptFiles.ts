// --------------------------------------------------
// UPLOADED FILES IN THE PROMPT
//
// Typing / in the prompt lists the files uploaded for
// the model, numbered as their tiles are ("image 1",
// "image 2"). Picking one writes those words into the
// prompt, so the model knows which file is meant. Plain
// words, so every model understands them; a model with
// several fields of one kind gets the field's name
// ("end image", "reference video 2").
// --------------------------------------------------

import { fieldLabel, fileKind, type FileKind, type Schema } from "./fields";

export type PromptFile = {
  // What goes in the prompt: "image 2", "end image"
  token: string;
  // The field it's in: "Reference images"
  field: string;
  kind: FileKind;
  url: string;
};

const NOUN: Record<FileKind, string> = { image: "image", video: "video", audio: "audio" };

// Inputs that take several files though typed as text
const LIST_KEY = /_urls$|image_input|reference_(images|videos|audios)/;

// The field's files, in the order the model gets them
function filesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" && value ? [value] : [];
}

export function promptFiles(schema: Schema, inputs: Record<string, unknown>, model: string): PromptFile[] {
  const fields = Object.entries(schema)
    .map(([key, field]) => ({ key, field, kind: fileKind(key, field) }))
    .filter((item): item is typeof item & { kind: FileKind } => item.kind !== null)
    .sort((a, b) => (a.field["x-order"] ?? 999) - (b.field["x-order"] ?? 999));

  const isList = (key: string, field: Schema[string]) => field.type === "array" || LIST_KEY.test(key);
  const count = (kind: FileKind, list: boolean) =>
    fields.filter((item) => item.kind === kind && isList(item.key, item.field) === list).length;

  return fields.flatMap(({ key, field, kind }) => {
    const label = fieldLabel(key, field, { schema, model });
    const files = filesOf(inputs[key]);
    // Lists are numbered; one file ("end image") isn't
    const list = isList(key, field) || files.length > 1;
    // The kind's name ("image 2") for its only list, or
    // when it's its only field; otherwise the field's name
    const plain = isList(key, field) ? count(kind, true) === 1 : count(kind, true) + count(kind, false) === 1;
    const name = plain ? NOUN[kind] : list ? label.replace(/s$/, "") : label;

    return files.map((url, index) => ({
      token: (list ? `${name} ${index + 1}` : name).toLowerCase(),
      field: label,
      kind,
      url,
    }));
  });
}

// "image 1", not inside "image 12" or "myimage 1"
export function filesPattern(files: PromptFile[]): RegExp | null {
  if (!files.length) return null;

  const tokens = [...new Set(files.map((file) => file.token))]
    // Longest first, so "end image" wins over "image"
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));

  return new RegExp(`((?<![\\p{L}\\p{N}_@/-])(?:${tokens.join("|")})(?![\\p{L}\\p{N}_-]))`, "giu");
}

// Files whose name has what's typed after /: "im2" or
// "2" finds "image 2"
export function matchFiles(files: PromptFile[], query: string): PromptFile[] {
  const typed = [...query.toLowerCase()];

  // The typed letters in order, gaps allowed
  return files.filter((file) => {
    let at = 0;
    for (const char of file.token.replace(/\s+/g, "")) {
      if (char === typed[at]) at += 1;
    }
    return at === typed.length;
  });
}

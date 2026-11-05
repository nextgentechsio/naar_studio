import { head } from "@vercel/blob";
import { ObjectId } from "mongodb";
import type { StoredUser } from "@/lib/auth/users";
import { canManageProjects } from "@/lib/auth/roles";
import { catalogueCollections, libraryFolder, type AssetDoc, type TemplateDoc } from "./db";
import { tidyLibrary } from "./files";
import { PRESET_ASSETS, PRESET_TEMPLATES } from "./presets";
import {
  ASSET_KINDS,
  GENDERS,
  MAX_SHOTS,
  NAME_MAX,
  PROMPT_MAX,
  SHOT_TYPES,
  type AssetKind,
  type PublicAsset,
  type PublicTemplate,
  type ShotDefinition,
} from "./shared";

// --------------------------------------------------
// CATALOGUE LIBRARY: models, poses, backgrounds,
// accessories and templates. Everyone signed in picks
// from active items; admins (and the super admin) add,
// edit and archive them. Built-in presets are inserted
// once and can then be edited like any other item.
// --------------------------------------------------

export class CatalogueError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Actor = Pick<StoredUser, "id" | "role" | "disabled">;

export function canEditLibrary(actor: Actor) {
  return canManageProjects(actor);
}

function editor(actor: Actor) {
  if (!canEditLibrary(actor)) throw new CatalogueError(403, "Only admins can change the catalogue library");
}

export function objectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new CatalogueError(404, "Not found");
  return new ObjectId(id);
}

// ---------- Built-in presets ----------

const globalForSeed = globalThis as unknown as { catalogueSeeded?: Promise<void> };

export function ensureSeeded(): Promise<void> {
  globalForSeed.catalogueSeeded ??= seed().catch((error) => {
    globalForSeed.catalogueSeeded = undefined;
    throw error;
  });
  return globalForSeed.catalogueSeeded;
}

async function seed() {
  const { assets, templates } = await catalogueCollections();
  const now = new Date();

  // Insert-only: an admin's edits to a preset are kept
  await assets.bulkWrite(
    PRESET_ASSETS.map((preset) => ({
      updateOne: {
        filter: { presetKey: preset.key },
        update: {
          $setOnInsert: {
            _id: new ObjectId(),
            kind: preset.kind,
            name: preset.name,
            prompt: preset.prompt,
            notes: preset.notes,
            gender: preset.gender,
            setting: preset.setting,
            imageUrl: null,
            status: "active" as const,
            presetKey: preset.key,
            createdBy: "system",
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  const ids = new Map(
    (await assets.find({ presetKey: { $in: PRESET_ASSETS.map((preset) => preset.key) } }).toArray()).map((doc) => [
      doc.presetKey!,
      doc._id.toHexString(),
    ]),
  );

  await templates.bulkWrite(
    PRESET_TEMPLATES.map((preset) => ({
      updateOne: {
        filter: { presetKey: preset.key },
        update: {
          $setOnInsert: {
            _id: new ObjectId(),
            name: preset.name,
            description: preset.description,
            styling: preset.styling,
            categories: preset.categories,
            shots: preset.shots.map(({ poseKey, backgroundKey, ...shot }) => ({
              ...shot,
              poseId: (poseKey && ids.get(poseKey)) || null,
              backgroundId: (backgroundKey && ids.get(backgroundKey)) || null,
            })),
            status: "active" as const,
            presetKey: preset.key,
            createdBy: "system",
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

// ---------- Assets ----------

export function toAsset(doc: AssetDoc): PublicAsset {
  return {
    id: doc._id.toHexString(),
    kind: doc.kind,
    name: doc.name,
    prompt: doc.prompt,
    notes: doc.notes,
    gender: doc.gender,
    setting: doc.setting,
    imageUrl: doc.imageUrl,
    status: doc.status,
    builtIn: Boolean(doc.presetKey),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listAssets(options: { includeArchived?: boolean } = {}): Promise<PublicAsset[]> {
  await ensureSeeded();
  const { assets } = await catalogueCollections();
  const docs = await assets
    .find({ deleted: { $ne: true }, ...(options.includeArchived ? {} : { status: "active" as const }) })
    .sort({ kind: 1, name: 1 })
    .limit(1000)
    .toArray();
  return docs.map(toAsset);
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new CatalogueError(400, `${label} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new CatalogueError(400, `Add a ${label.toLowerCase()}`);
  if (trimmed.length > max) throw new CatalogueError(400, `Keep the ${label.toLowerCase()} under ${max} characters`);
  return trimmed;
}

// A library photo the browser uploaded to catalogue/library/
async function libraryImage(url: unknown): Promise<string | null> {
  if (url === null || url === undefined || url === "") return null;
  if (typeof url !== "string") throw new CatalogueError(400, "Invalid image");
  let blob: Awaited<ReturnType<typeof head>>;
  try {
    blob = await head(url);
  } catch {
    throw new CatalogueError(400, "The uploaded image wasn't found");
  }
  if (!blob.pathname.startsWith(libraryFolder()) || blob.pathname.includes("..")) {
    throw new CatalogueError(403, "That image isn't in the catalogue library folder");
  }
  if (!blob.contentType.startsWith("image/")) throw new CatalogueError(415, "Only images can be used");
  return blob.url;
}

type AssetInput = Partial<Pick<PublicAsset, "name" | "prompt" | "notes" | "gender" | "setting" | "imageUrl" | "status">> & {
  kind?: AssetKind;
};

async function assetFields(input: AssetInput, kind: AssetKind, partial: boolean) {
  const fields: Partial<AssetDoc> = {};
  if (!partial || input.name !== undefined) fields.name = text(input.name, "Name", NAME_MAX, true);
  if (!partial || input.prompt !== undefined) {
    fields.prompt = text(input.prompt, "Description", PROMPT_MAX, kind !== "model" && kind !== "accessory");
  }
  if (!partial || input.notes !== undefined) fields.notes = text(input.notes, "Notes", PROMPT_MAX);
  if (!partial || input.gender !== undefined) {
    const gender = input.gender ?? null;
    if (gender !== null && !GENDERS.includes(gender)) throw new CatalogueError(400, "Unknown gender");
    fields.gender = kind === "model" || kind === "pose" ? gender : null;
  }
  if (!partial || input.setting !== undefined) {
    const setting = input.setting ?? null;
    if (setting !== null && setting !== "studio" && setting !== "lifestyle") {
      throw new CatalogueError(400, "Setting must be studio or lifestyle");
    }
    fields.setting = kind === "background" ? (setting ?? "studio") : null;
  }
  if (!partial || input.imageUrl !== undefined) fields.imageUrl = await libraryImage(input.imageUrl);
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "archived") throw new CatalogueError(400, "Unknown status");
    fields.status = input.status;
  }
  return fields;
}

export async function createAsset(actor: Actor, input: AssetInput): Promise<PublicAsset> {
  editor(actor);
  const kind = input.kind;
  if (!kind || !ASSET_KINDS.includes(kind)) throw new CatalogueError(400, "Choose what kind of item this is");
  const fields = await assetFields(input, kind, false);
  const now = new Date();
  const doc: AssetDoc = {
    _id: new ObjectId(),
    kind,
    name: fields.name!,
    prompt: fields.prompt ?? "",
    notes: fields.notes ?? "",
    gender: fields.gender ?? null,
    setting: fields.setting ?? null,
    imageUrl: fields.imageUrl ?? null,
    status: fields.status ?? "active",
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  const { assets } = await catalogueCollections();
  await assets.insertOne(doc);
  return toAsset(doc);
}

export async function updateAsset(actor: Actor, id: string, input: AssetInput): Promise<PublicAsset> {
  editor(actor);
  const { assets } = await catalogueCollections();
  const existing = await assets.findOne({ _id: objectId(id), deleted: { $ne: true } });
  if (!existing) throw new CatalogueError(404, "Not found");
  const fields = await assetFields(input, existing.kind, true);
  const updated = await assets.findOneAndUpdate(
    { _id: existing._id },
    { $set: { ...fields, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  // A replaced photo leaves the library folder
  if (existing.imageUrl && fields.imageUrl !== undefined && fields.imageUrl !== existing.imageUrl) {
    await tidyLibrary([existing.imageUrl]);
  }
  return toAsset(updated!);
}

// Permanent; products keep working (a missing item is
// simply left out of their prompts)
export async function deleteAsset(actor: Actor, id: string): Promise<void> {
  editor(actor);
  const { assets } = await catalogueCollections();
  // A built-in is kept as a marker, so the preset isn't
  // inserted again on the next start
  const result = await assets.findOneAndDelete({ _id: objectId(id), deleted: { $ne: true }, presetKey: { $exists: false } });
  if (result) {
    if (result.imageUrl) await tidyLibrary([result.imageUrl]);
    return;
  }
  const marked = await assets.findOneAndUpdate(
    { _id: objectId(id), deleted: { $ne: true } },
    { $set: { deleted: true, status: "archived", imageUrl: null, updatedAt: new Date() } },
  );
  if (!marked) throw new CatalogueError(404, "Not found");
  if (marked.imageUrl) await tidyLibrary([marked.imageUrl]);
}

export async function assetsByIds(ids: (string | null | undefined)[]): Promise<Map<string, PublicAsset>> {
  const valid = [...new Set(ids.filter((id): id is string => Boolean(id) && ObjectId.isValid(id!)))];
  if (!valid.length) return new Map();
  const { assets } = await catalogueCollections();
  const docs = await assets.find({ _id: { $in: valid.map((id) => new ObjectId(id)) } }).toArray();
  return new Map(docs.map((doc) => [doc._id.toHexString(), toAsset(doc)]));
}

// ---------- Templates ----------

export function toTemplate(doc: TemplateDoc): PublicTemplate {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    description: doc.description,
    styling: doc.styling,
    categories: doc.categories,
    shots: doc.shots,
    status: doc.status,
    builtIn: Boolean(doc.presetKey),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listTemplates(options: { includeArchived?: boolean } = {}): Promise<PublicTemplate[]> {
  await ensureSeeded();
  const { templates } = await catalogueCollections();
  const docs = await templates
    .find({ deleted: { $ne: true }, ...(options.includeArchived ? {} : { status: "active" as const }) })
    .sort({ name: 1 })
    .limit(200)
    .toArray();
  return docs.map(toTemplate);
}

export async function getTemplate(id: string): Promise<PublicTemplate | null> {
  if (!ObjectId.isValid(id)) return null;
  const { templates } = await catalogueCollections();
  const doc = await templates.findOne({ _id: new ObjectId(id), deleted: { $ne: true } });
  return doc ? toTemplate(doc) : null;
}

function parseShots(value: unknown): ShotDefinition[] {
  if (!Array.isArray(value) || !value.length) throw new CatalogueError(400, "Add at least one shot");
  if (value.length > MAX_SHOTS) throw new CatalogueError(400, `Keep it to ${MAX_SHOTS} shots or fewer`);
  const seen = new Set<string>();
  const shots = value.map((raw, index) => {
    const shot = (raw ?? {}) as Record<string, unknown>;
    const type = shot.type as ShotDefinition["type"];
    if (!SHOT_TYPES.includes(type)) throw new CatalogueError(400, `Shot ${index + 1}: unknown type`);
    let id = typeof shot.id === "string" && /^[a-z0-9-]{1,40}$/.test(shot.id) ? shot.id : type;
    for (let n = 2; seen.has(id); n++) id = `${type}-${n}`;
    seen.add(id);
    const ref = (key: string) => {
      const v = shot[key];
      if (v === null || v === undefined || v === "") return null;
      if (typeof v !== "string" || !ObjectId.isValid(v)) throw new CatalogueError(400, `Shot ${index + 1}: invalid ${key}`);
      return v;
    };
    return {
      id,
      label: text(shot.label, "Shot name", NAME_MAX, true),
      type,
      prompt: text(shot.prompt, "Shot description", PROMPT_MAX, true),
      poseId: ref("poseId"),
      backgroundId: ref("backgroundId"),
    };
  });
  if (shots[0].type !== "initial") throw new CatalogueError(400, "The first shot must be the initial look");
  if (shots.slice(1).some((shot) => shot.type === "initial")) {
    throw new CatalogueError(400, "Only the first shot can be the initial look");
  }
  return shots;
}

type TemplateInput = Partial<Pick<PublicTemplate, "name" | "description" | "styling" | "categories" | "shots" | "status">>;

function templateFields(input: TemplateInput, partial: boolean) {
  const fields: Partial<TemplateDoc> = {};
  if (!partial || input.name !== undefined) fields.name = text(input.name, "Name", NAME_MAX, true);
  if (!partial || input.description !== undefined) fields.description = text(input.description, "Description", PROMPT_MAX);
  if (!partial || input.styling !== undefined) fields.styling = text(input.styling, "Styling", PROMPT_MAX);
  if (!partial || input.categories !== undefined) {
    const categories = input.categories ?? [];
    if (!Array.isArray(categories) || !categories.every((c) => typeof c === "string")) {
      throw new CatalogueError(400, "Invalid categories");
    }
    fields.categories = [...new Set(categories.map((c) => c.trim()).filter(Boolean))].slice(0, 30);
  }
  if (!partial || input.shots !== undefined) fields.shots = parseShots(input.shots);
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "archived") throw new CatalogueError(400, "Unknown status");
    fields.status = input.status;
  }
  return fields;
}

export async function createTemplate(actor: Actor, input: TemplateInput): Promise<PublicTemplate> {
  editor(actor);
  const fields = templateFields(input, false);
  const now = new Date();
  const doc: TemplateDoc = {
    _id: new ObjectId(),
    name: fields.name!,
    description: fields.description ?? "",
    styling: fields.styling ?? "",
    categories: fields.categories ?? [],
    shots: fields.shots!,
    status: fields.status ?? "active",
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };
  const { templates } = await catalogueCollections();
  await templates.insertOne(doc);
  return toTemplate(doc);
}

export async function updateTemplate(actor: Actor, id: string, input: TemplateInput): Promise<PublicTemplate> {
  editor(actor);
  const fields = templateFields(input, true);
  const { templates } = await catalogueCollections();
  const updated = await templates.findOneAndUpdate(
    { _id: objectId(id), deleted: { $ne: true } },
    { $set: { ...fields, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) throw new CatalogueError(404, "Not found");
  return toTemplate(updated);
}

export async function deleteTemplate(actor: Actor, id: string): Promise<void> {
  editor(actor);
  const { templates } = await catalogueCollections();
  const result = await templates.findOneAndDelete({ _id: objectId(id), deleted: { $ne: true }, presetKey: { $exists: false } });
  if (result) return;
  const marked = await templates.updateOne(
    { _id: objectId(id), deleted: { $ne: true } },
    { $set: { deleted: true, status: "archived", updatedAt: new Date() } },
  );
  if (!marked.matchedCount) throw new CatalogueError(404, "Not found");
}

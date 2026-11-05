import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { del, head, list, put } from "@vercel/blob";
import { ObjectId } from "mongodb";
import type { StoredUser } from "@/lib/auth/users";
import { canManageUsers } from "@/lib/auth/roles";
import { expensesCollection } from "@/lib/db/mongodb";
import {
  applyPrediction,
  fetchGenerationStatus,
  getGeneration,
  isTerminalStatus,
} from "@/lib/generations";
import { findActiveProjectByName } from "@/lib/projects";
import { openOutput } from "@/lib/storage/generation-outputs";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import { catalogueCollections, productFolder, type ProductDoc, type RunDoc } from "./db";
import { assetsByIds, CatalogueError, getTemplate, objectId } from "./library";
import { buildShotRequest, type Reference, type RefRole } from "./prompt";
import { startDirectRun } from "./direct";
import { RunError, shotInputs, startImageRun } from "./run";
import {
  CATEGORIES,
  DEFAULT_IMAGE_MODEL,
  FEEDBACK_MAX,
  GENDERS,
  IMAGE_MODELS,
  INPUT_SLOTS,
  MAX_ACCESSORIES,
  NAME_MAX,
  PROMPT_MAX,
  RESOLUTIONS,
  type InputSlot,
  type ProductSummary,
  type PublicProduct,
  type ShotDefinition,
  type ShotRun,
} from "./shared";

// --------------------------------------------------
// CATALOGUE PRODUCTS
//
// Private to their creator; admins (and the super admin)
// can see and work on everyone's. Each image is started
// with startImageRun (a normal Naar generation, billed to
// the product's project) and linked here as a run;
// reading a product brings its unfinished runs up to date
// and keeps a permanent copy of each finished image.
// --------------------------------------------------

type Actor = StoredUser;

// Runs started at once when a product is approved
const SHOT_CONCURRENCY = 4;
// A run whose generation never finishes is failed after
const RUN_STALE_MS = 20 * 60 * 1000;
const COPY_CLAIM_MS = 60 * 1000;
const RUNS_PER_SHOT = 20;

function canSee(actor: Actor, doc: Pick<ProductDoc, "userId">) {
  return doc.userId === actor.id || canManageUsers(actor);
}

async function load(actor: Actor, id: string): Promise<ProductDoc> {
  const { products } = await catalogueCollections();
  const doc = await products.findOne({ _id: objectId(id) });
  if (!doc || !canSee(actor, doc)) throw new CatalogueError(404, "Product not found");
  return doc;
}

function text(value: unknown, label: string, max: number, required = false): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new CatalogueError(400, `${label} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new CatalogueError(400, `Add a ${label.toLowerCase()}`);
  if (trimmed.length > max) throw new CatalogueError(400, `Keep the ${label.toLowerCase()} under ${max} characters`);
  return trimmed;
}

function requireBlob() {
  if (!blobUploadsEnabled()) {
    throw new CatalogueError(501, "Catalogue needs Vercel Blob storage (BLOB_READ_WRITE_TOKEN)");
  }
}

// ---------- Create / list ----------

export async function createProduct(actor: Actor, body: Record<string, unknown>): Promise<PublicProduct> {
  requireBlob();
  const project = await findActiveProjectByName(text(body.project, "Project", 200, true));
  if (!project) throw new CatalogueError(400, "Unknown or archived project");
  const gender = (body.gender ?? "female") as ProductDoc["gender"];
  if (!GENDERS.includes(gender)) throw new CatalogueError(400, "Unknown gender");

  const now = new Date();
  const doc: ProductDoc = {
    _id: new ObjectId(),
    userId: actor.id,
    userName: actor.name,
    projectId: project.id,
    projectName: project.name,
    name: text(body.name, "Name", NAME_MAX, true),
    sku: text(body.sku, "SKU", 80),
    category: text(body.category, "Category", 60) || CATEGORIES[0],
    gender,
    notes: text(body.notes, "Notes", PROMPT_MAX),
    templateId: null,
    plan: [],
    styling: "",
    modelId: null,
    poseId: null,
    backgroundId: null,
    accessoryIds: [],
    inputs: {},
    imageModel: DEFAULT_IMAGE_MODEL,
    resolution: "2K",
    status: "draft",
    selected: {},
    createdAt: now,
    updatedAt: now,
  };
  const { products } = await catalogueCollections();
  await products.insertOne(doc);
  return present(doc, []);
}

export async function listProducts(actor: Actor): Promise<ProductSummary[]> {
  const { products, runs } = await catalogueCollections();
  const docs = await products
    .find(canManageUsers(actor) ? {} : { userId: actor.id })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();

  const covers = new Map<string, string>();
  const selectedIds = docs.flatMap((doc) => Object.values(doc.selected));
  if (selectedIds.length) {
    const done = await runs
      .find({ _id: { $in: selectedIds }, imageUrl: { $ne: null } }, { projection: { productId: 1, shotId: 1, imageUrl: 1 } })
      .toArray();
    const byId = new Map(done.map((run) => [run._id, run]));
    for (const doc of docs) {
      const first = doc.plan.map((shot) => byId.get(doc.selected[shot.id] ?? ""))?.find(Boolean);
      if (first?.imageUrl) covers.set(doc._id.toHexString(), first.imageUrl);
    }
  }

  // Spend and finished images per product
  const spend = new Map<string, { usd: number; images: number }>();
  if (docs.length) {
    const all = await runs
      .find({ productId: { $in: docs.map((doc) => doc._id.toHexString()) } }, { projection: { productId: 1, status: 1 } })
      .toArray();
    const productOf = new Map(all.map((run) => [run._id, run.productId]));
    for (const run of all) {
      const entry = spend.get(run.productId) ?? { usd: 0, images: 0 };
      if (run.status === "succeeded") entry.images++;
      spend.set(run.productId, entry);
    }
    if (all.length) {
      const rows = await (await expensesCollection())
        .find({ _id: { $in: all.map((run) => run._id) } }, { projection: { amountUsd: 1 } })
        .toArray();
      for (const row of rows) {
        const entry = spend.get(productOf.get(row._id)!);
        if (entry) entry.usd += row.amountUsd ?? 0;
      }
    }
  }

  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    images: spend.get(doc._id.toHexString())?.images ?? 0,
    spendUsd: Math.round((spend.get(doc._id.toHexString())?.usd ?? 0) * 1000) / 1000,
    name: doc.name,
    sku: doc.sku,
    category: doc.category,
    status: doc.status,
    project: { id: doc.projectId, name: doc.projectName },
    owner: { id: doc.userId, name: doc.userName },
    updatedAt: doc.updatedAt.toISOString(),
    cover: covers.get(doc._id.toHexString()) ?? null,
    shotCount: Object.keys(doc.selected).length,
  }));
}

// ---------- Read (with run sync) ----------

export async function getProduct(actor: Actor, id: string): Promise<PublicProduct> {
  const doc = await load(actor, id);
  const { runs } = await catalogueCollections();
  let list = await runs.find({ productId: id }).sort({ createdAt: -1 }).limit(500).toArray();

  if (list.some((run) => run.status === "pending" || (run.status === "succeeded" && !run.imageUrl))) {
    await Promise.all(list.filter((run) => run.status !== "failed" && !run.imageUrl).map((run) => syncRun(doc, run)));
    list = await runs.find({ productId: id }).sort({ createdAt: -1 }).limit(500).toArray();
  }

  const fresh = await autoSelect(doc, list);
  return present(fresh, list);
}

// Brings one run up to date with its generation; on
// success keeps our own copy of the image
async function syncRun(product: ProductDoc, run: RunDoc): Promise<void> {
  const { runs } = await catalogueCollections();
  const fail = (error: string) =>
    runs.updateOne({ _id: run._id, status: "pending" }, { $set: { status: "failed", error, updatedAt: new Date() } });

  try {
    let generation = await getGeneration(run._id);
    if (!generation) return void (await fail("The run's record is missing"));

    if (!isTerminalStatus(generation.status)) {
      const result = await fetchGenerationStatus(generation);
      if (!result.ok) {
        if (Date.now() - run.createdAt.getTime() > RUN_STALE_MS) await fail("The image model stopped responding");
        return;
      }
      const status = String(result.prediction.status ?? "");
      if (!isTerminalStatus(status)) {
        if (Date.now() - run.createdAt.getTime() > RUN_STALE_MS) await fail("This took too long. Try again.");
        return;
      }
      // Prices it, saves the output, records the expense
      await applyPrediction(generation, result.prediction);
      generation = (await getGeneration(run._id))!;
    }

    if (generation.status !== "succeeded") {
      return void (await fail(generation.error || "The image model couldn't make this shot"));
    }

    await runs.updateOne({ _id: run._id, status: "pending" }, { $set: { status: "succeeded", updatedAt: new Date() } });

    // Copy the image to catalogue/ (one request at a time)
    const now = new Date();
    const claim = await runs.findOneAndUpdate(
      {
        _id: run._id,
        imageUrl: null,
        $or: [{ copyingUntil: null }, { copyingUntil: { $exists: false } }, { copyingUntil: { $lt: now } }],
      },
      { $set: { copyingUntil: new Date(now.getTime() + COPY_CLAIM_MS) } },
    );
    if (!claim) return;

    try {
      const bytes = await outputBytes(generation);
      const type = (generation.outputContentType ?? "image/jpeg").split(";")[0].trim() || "image/jpeg";
      const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const blob = await put(
        `${productFolder(product.userId, product._id.toHexString())}shots/${run.shotId}-${run._id}.${ext}`,
        bytes,
        { access: "public", addRandomSuffix: true, contentType: type },
      );
      await runs.updateOne(
        { _id: run._id },
        { $set: { imageUrl: blob.url, copyingUntil: null, updatedAt: new Date() } },
      );
    } catch (error) {
      await runs.updateOne({ _id: run._id }, { $set: { copyingUntil: null } });
      throw error;
    }
  } catch (error) {
    console.error("Catalogue: sync run failed:", run._id, error);
  }
}

async function outputBytes(generation: NonNullable<Awaited<ReturnType<typeof getGeneration>>>): Promise<Buffer> {
  if (!generation.outputBlobUrl && generation.outputFileId) {
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.fromWeb(
      (await openOutput(generation.outputFileId, null)) as unknown as NodeReadableStream<Uint8Array>,
    )) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
  const url = generation.outputBlobUrl ?? generation.outputUrl;
  if (!url) throw new Error("No output to copy");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Output read failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// A shot with no chosen version takes its newest finished
// one; the product is "done" once every shot has one
async function autoSelect(doc: ProductDoc, runs: RunDoc[]): Promise<ProductDoc> {
  const set: Record<string, string> = {};
  for (const shot of doc.plan) {
    const current = doc.selected[shot.id];
    if (current && runs.some((run) => run._id === current && run.status === "succeeded")) continue;
    const newest = runs.find((run) => run.shotId === shot.id && run.status === "succeeded" && run.imageUrl);
    if (newest) set[`selected.${shot.id}`] = newest._id;
  }
  const selected = { ...doc.selected, ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k.slice(9), v])) };
  const status =
    doc.status === "shooting" && doc.plan.every((shot) => selected[shot.id]) && !runs.some((run) => run.status === "pending")
      ? "done"
      : doc.status;

  if (!Object.keys(set).length && status === doc.status) return doc;
  const { products } = await catalogueCollections();
  await products.updateOne({ _id: doc._id }, { $set: { ...set, status } });
  return { ...doc, selected, status };
}

async function present(doc: ProductDoc, runs: RunDoc[]): Promise<PublicProduct> {
  const id = doc._id.toHexString();
  let spendUsd = 0;
  if (runs.length) {
    const [row] = await (await expensesCollection())
      .aggregate<{ total: number }>([
        { $match: { _id: { $in: runs.map((run) => run._id) } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amountUsd", 0] } } } },
      ])
      .toArray();
    spendUsd = Math.round((row?.total ?? 0) * 1000) / 1000;
  }

  return {
    id,
    name: doc.name,
    sku: doc.sku,
    category: doc.category,
    gender: doc.gender,
    notes: doc.notes,
    project: { id: doc.projectId, name: doc.projectName },
    templateId: doc.templateId,
    modelId: doc.modelId,
    poseId: doc.poseId,
    backgroundId: doc.backgroundId,
    accessoryIds: doc.accessoryIds,
    inputs: doc.inputs,
    imageModel: doc.imageModel,
    resolution: doc.resolution,
    status: doc.status,
    shots: doc.plan.map((shot) => ({
      shotId: shot.id,
      label: shot.label,
      selected: doc.selected[shot.id] ?? null,
      runs: runs
        .filter((run) => run.shotId === shot.id)
        .slice(0, RUNS_PER_SHOT)
        .map(
          (run): ShotRun => ({
            generationId: run._id,
            status: run.status === "succeeded" && !run.imageUrl ? "pending" : run.status,
            imageUrl: run.imageUrl,
            error: run.error,
            feedback: run.feedback,
            model: run.model,
            createdAt: run.createdAt.toISOString(),
          }),
        ),
    })),
    spendUsd,
    projectLocked: runs.length > 0,
    owner: { id: doc.userId, name: doc.userName },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ---------- Update ----------

function optionalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new CatalogueError(400, `Invalid ${label}`);
  return value;
}

// An uploaded garment photo must be in this product's folder
async function inputImage(doc: ProductDoc, url: unknown): Promise<string | null> {
  if (url === null || url === "") return null;
  if (typeof url !== "string") throw new CatalogueError(400, "Invalid image");
  let blob: Awaited<ReturnType<typeof head>>;
  try {
    blob = await head(url);
  } catch {
    throw new CatalogueError(400, "The uploaded image wasn't found");
  }
  if (!blob.pathname.startsWith(productFolder(doc.userId, doc._id.toHexString())) || blob.pathname.includes("..")) {
    throw new CatalogueError(403, "That image isn't in this product's folder");
  }
  if (!blob.contentType.startsWith("image/")) throw new CatalogueError(415, "Only images can be used");
  return blob.url;
}

export async function updateProduct(actor: Actor, id: string, body: Record<string, unknown>): Promise<PublicProduct> {
  const doc = await load(actor, id);
  const set: Partial<ProductDoc> & Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  const locked = doc.status === "shooting" || doc.status === "done";

  if (body.name !== undefined) set.name = text(body.name, "Name", NAME_MAX, true);
  if (body.sku !== undefined) set.sku = text(body.sku, "SKU", 80);
  if (body.category !== undefined) set.category = text(body.category, "Category", 60);
  if (body.notes !== undefined) set.notes = text(body.notes, "Notes", PROMPT_MAX);
  if (body.gender !== undefined) {
    if (!GENDERS.includes(body.gender as ProductDoc["gender"])) throw new CatalogueError(400, "Unknown gender");
    set.gender = body.gender as ProductDoc["gender"];
  }
  if (body.project !== undefined) {
    const project = await findActiveProjectByName(text(body.project, "Project", 200, true));
    if (!project) throw new CatalogueError(400, "Unknown or archived project");
    const { runs } = await catalogueCollections();
    if (project.id !== doc.projectId && (await runs.findOne({ productId: id }))) {
      throw new CatalogueError(409, "This product already has images billed to its project, so the project can't change");
    }
    set.projectId = project.id;
    set.projectName = project.name;
  }
  if (body.templateId !== undefined) {
    const templateId = optionalId(body.templateId, "template");
    if (locked && templateId !== doc.templateId) {
      throw new CatalogueError(409, "The template can't change after the initial look is approved");
    }
    const template = templateId ? await getTemplate(templateId) : null;
    if (templateId && (!template || template.status !== "active")) throw new CatalogueError(400, "Unknown template");
    set.templateId = templateId;
    if (!locked) {
      set.plan = template?.shots ?? [];
      set.styling = template?.styling ?? "";
    }
  }
  for (const key of ["modelId", "poseId", "backgroundId"] as const) {
    if (body[key] !== undefined) set[key] = optionalId(body[key], key.replace("Id", ""));
  }
  if (body.accessoryIds !== undefined) {
    if (!Array.isArray(body.accessoryIds)) throw new CatalogueError(400, "Invalid accessories");
    const ids = [...new Set(body.accessoryIds.map((value) => optionalId(value, "accessory")).filter(Boolean))] as string[];
    if (ids.length > MAX_ACCESSORIES) throw new CatalogueError(400, `Choose up to ${MAX_ACCESSORIES} accessories`);
    set.accessoryIds = ids;
  }
  if (body.imageModel !== undefined) {
    if (!IMAGE_MODELS.some((model) => model.id === body.imageModel)) throw new CatalogueError(400, "Unknown image model");
    set.imageModel = body.imageModel as ProductDoc["imageModel"];
  }
  if (body.resolution !== undefined) {
    if (!RESOLUTIONS.includes(body.resolution as ProductDoc["resolution"])) throw new CatalogueError(400, "Unknown size");
    set.resolution = body.resolution as ProductDoc["resolution"];
  }
  if (body.inputs !== undefined) {
    if (!body.inputs || typeof body.inputs !== "object" || Array.isArray(body.inputs)) {
      throw new CatalogueError(400, "Invalid photos");
    }
    for (const [slot, url] of Object.entries(body.inputs as Record<string, unknown>)) {
      if (!INPUT_SLOTS.some((item) => item.key === slot)) throw new CatalogueError(400, `Unknown photo slot: ${slot}`);
      const checked = await inputImage(doc, url);
      if (checked) set[`inputs.${slot}`] = checked;
      else unset[`inputs.${slot}`] = "";
    }
  }

  const { products } = await catalogueCollections();
  await products.updateOne(
    { _id: doc._id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  );
  return getProduct(actor, id);
}

// ---------- Generate ----------

const SLOT_ROLES: Record<InputSlot, RefRole> = {
  front: "garment_front",
  back: "garment_back",
  detail: "garment_detail",
  extra: "garment_extra",
  pairing: "pairing",
  footwear: "footwear",
};

async function startShot(
  actor: Actor,
  doc: ProductDoc,
  shot: ShotDefinition,
  options: { feedback: string; initialUrl: string | null; poseId?: string | null; backgroundId?: string | null },
): Promise<string> {
  const isInitial = shot.type === "initial";
  // Shot's own choice, else the product's
  const poseId = options.poseId ?? shot.poseId ?? doc.poseId;
  const backgroundId = options.backgroundId ?? shot.backgroundId ?? doc.backgroundId;
  const assets = await assetsByIds([doc.modelId, poseId, backgroundId, ...doc.accessoryIds]);
  const model = (doc.modelId && assets.get(doc.modelId)) || null;
  const pose = (poseId && assets.get(poseId)) || null;
  const background = (backgroundId && assets.get(backgroundId)) || null;
  const accessories = doc.accessoryIds.map((id) => assets.get(id)).filter((asset) => asset !== undefined);

  const references: Reference[] = [];
  for (const [slot, url] of Object.entries(doc.inputs) as [InputSlot, string][]) {
    references.push({ role: SLOT_ROLES[slot], url });
  }
  if (model?.imageUrl) references.push({ role: "model_face", url: model.imageUrl, label: model.name });
  if (background?.imageUrl) references.push({ role: "background", url: background.imageUrl, label: background.name });
  for (const accessory of accessories) {
    if (accessory.imageUrl) references.push({ role: "accessory", url: accessory.imageUrl, label: accessory.name });
  }
  if (!isInitial && options.initialUrl) references.push({ role: "initial_look", url: options.initialUrl });
  // With feedback: the attempt being corrected
  if (options.feedback) {
    const { runs } = await catalogueCollections();
    const previous = await runs.findOne(
      { productId: doc._id.toHexString(), shotId: shot.id, status: "succeeded", imageUrl: { $ne: null } },
      { sort: { createdAt: -1 } },
    );
    if (previous?.imageUrl) references.push({ role: "previous", url: previous.imageUrl });
  }

  const maxRefs = IMAGE_MODELS.find((item) => item.id === doc.imageModel)?.maxRefs ?? 8;
  const request = buildShotRequest({
    shot,
    isInitial,
    product: { name: doc.name, category: doc.category, gender: doc.gender, notes: doc.notes },
    styling: doc.styling,
    model,
    pose,
    background,
    accessories,
    feedback: options.feedback,
    references,
    maxRefs,
  });

  const project = { id: doc.projectId, name: doc.projectName };
  const direct = /^(google|openai):(.+)$/.exec(doc.imageModel);
  const generationId = direct
    ? await startDirectRun({
        user: actor,
        project,
        engine: direct[1] as "google" | "openai",
        model: direct[2],
        prompt: request.prompt,
        references: request.references,
        resolution: doc.resolution,
      })
    : await startImageRun({
        user: actor,
        project,
        model: doc.imageModel,
        inputs: shotInputs(doc.imageModel as Exclude<typeof doc.imageModel, `${string}:${string}`>, request.prompt, request.references, doc.resolution),
      });

  const now = new Date();
  const { runs } = await catalogueCollections();
  await runs.insertOne({
    _id: generationId,
    productId: doc._id.toHexString(),
    shotId: shot.id,
    userId: actor.id,
    model: doc.imageModel,
    feedback: options.feedback,
    status: "pending",
    imageUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  return generationId;
}

function runError(error: unknown): never {
  if (error instanceof CatalogueError) throw error;
  if (error instanceof RunError) throw new CatalogueError(error.status, error.message);
  throw error;
}

function ready(doc: ProductDoc) {
  if (!doc.inputs.front) throw new CatalogueError(400, "Upload the garment's front photo first");
  if (!doc.plan.length) throw new CatalogueError(400, "Choose a template first");
}

async function initialImage(doc: ProductDoc): Promise<string | null> {
  const id = doc.selected[doc.plan[0]?.id ?? ""];
  if (!id) return null;
  const { runs } = await catalogueCollections();
  return (await runs.findOne({ _id: id, status: "succeeded" }))?.imageUrl ?? null;
}

export async function generateInitial(actor: Actor, id: string, body: Record<string, unknown>): Promise<PublicProduct> {
  const doc = await load(actor, id);
  ready(doc);
  if (doc.status === "shooting" || doc.status === "done") {
    throw new CatalogueError(409, "The initial look is already approved. Regenerate it as a shot instead.");
  }
  const feedback = text(body.feedback, "Feedback", FEEDBACK_MAX);
  try {
    await startShot(actor, doc, doc.plan[0], { feedback, initialUrl: null });
  } catch (error) {
    runError(error);
  }
  const { products } = await catalogueCollections();
  await products.updateOne({ _id: doc._id }, { $set: { status: "initial", updatedAt: new Date() } });
  return getProduct(actor, id);
}

// Uses one of a shot's finished versions
export async function selectRun(actor: Actor, id: string, body: Record<string, unknown>): Promise<PublicProduct> {
  const doc = await load(actor, id);
  const shotId = String(body.shotId ?? "");
  const generationId = String(body.generationId ?? "");
  const { runs, products } = await catalogueCollections();
  const run = await runs.findOne({ _id: generationId, productId: id, shotId, status: "succeeded" });
  if (!run?.imageUrl) throw new CatalogueError(404, "That version isn't ready");
  await products.updateOne({ _id: doc._id }, { $set: { [`selected.${shotId}`]: generationId, updatedAt: new Date() } });
  return getProduct(actor, id);
}

// Locks the initial look and shoots every other shot
export async function approve(actor: Actor, id: string, body: Record<string, unknown>): Promise<PublicProduct> {
  await getProduct(actor, id); // sync first
  const doc = await load(actor, id);
  ready(doc);
  if (doc.status === "shooting" || doc.status === "done") throw new CatalogueError(409, "Already approved");
  const initialUrl = await initialImage(doc);
  if (!initialUrl) throw new CatalogueError(409, "Generate and choose an initial look first");

  const only = Array.isArray(body.shotIds) ? new Set(body.shotIds.map(String)) : null;
  const shots = doc.plan.slice(1).filter((shot) => !only || only.has(shot.id));

  const { products } = await catalogueCollections();
  await products.updateOne(
    { _id: doc._id },
    { $set: { status: shots.length ? "shooting" : "done", updatedAt: new Date() } },
  );

  // A few at a time; one shot failing to start doesn't stop the rest
  const failures: string[] = [];
  for (let i = 0; i < shots.length; i += SHOT_CONCURRENCY) {
    await Promise.all(
      shots.slice(i, i + SHOT_CONCURRENCY).map((shot) =>
        startShot(actor, doc, shot, { feedback: "", initialUrl }).catch((error) => {
          console.error("Catalogue: shot didn't start:", shot.id, error);
          failures.push(shot.label);
        }),
      ),
    );
  }
  if (failures.length === shots.length && shots.length) {
    await products.updateOne({ _id: doc._id }, { $set: { status: "initial" } });
    throw new CatalogueError(502, "The shots couldn't be started. Please try again.");
  }
  return getProduct(actor, id);
}

export async function regenerateShot(actor: Actor, id: string, body: Record<string, unknown>): Promise<PublicProduct> {
  const doc = await load(actor, id);
  ready(doc);
  const shot = doc.plan.find((item) => item.id === body.shotId);
  if (!shot) throw new CatalogueError(404, "Unknown shot");
  if (shot.type === "initial" && doc.status !== "shooting" && doc.status !== "done") {
    return generateInitial(actor, id, body);
  }
  if (doc.status !== "shooting" && doc.status !== "done") throw new CatalogueError(409, "Approve the initial look first");

  const { runs, products } = await catalogueCollections();
  if (await runs.findOne({ productId: id, shotId: shot.id, status: "pending" })) {
    throw new CatalogueError(409, "This shot is already being generated");
  }
  try {
    await startShot(actor, doc, shot, {
      feedback: text(body.feedback, "Feedback", FEEDBACK_MAX),
      initialUrl: shot.type === "initial" ? null : await initialImage(doc),
      poseId: optionalId(body.poseId, "pose"),
      backgroundId: optionalId(body.backgroundId, "background"),
    });
  } catch (error) {
    runError(error);
  }
  await products.updateOne({ _id: doc._id }, { $set: { status: "shooting", updatedAt: new Date() } });
  return getProduct(actor, id);
}

// The product, its runs and its files; the generations
// (and their expenses) stay, as for any deleted work
export async function deleteProduct(actor: Actor, id: string): Promise<void> {
  const doc = await load(actor, id);
  const { products, runs } = await catalogueCollections();
  if (blobUploadsEnabled()) {
    try {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: productFolder(doc.userId, id), cursor, limit: 1000 });
        if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    } catch (error) {
      console.error("Catalogue: couldn't delete product files:", id, error);
    }
  }
  await runs.deleteMany({ productId: id });
  await products.deleteOne({ _id: doc._id });
}

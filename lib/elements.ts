import { ObjectId } from "mongodb";
import {
  ELEMENT_NAME,
  ELEMENT_NAME_HINT,
  MAX_ELEMENT_DESCRIPTION,
  MAX_ELEMENT_IMAGES,
  type Element,
} from "@/lib/element-mentions";
import {
  elementsCollection,
  isDuplicateKeyError,
  libraryFilesCollection,
  type ElementDoc,
} from "@/lib/mongodb";

// --------------------------------------------------
// ELEMENTS
//
// A user's saved characters, products or objects: a name
// (mentioned in prompts as @name), a description and
// reference images from their media library. Private to
// the user, like the library.
// --------------------------------------------------

function toElement(doc: ElementDoc): Element {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    description: doc.description,
    images: doc.images,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export type ElementResult =
  | { ok: true; element: Element }
  | { ok: false; status: number; error: string };

type Fields = { name?: unknown; description?: unknown; images?: unknown };

type Checked =
  | { ok: true; values: Partial<Pick<ElementDoc, "name" | "nameKey" | "description" | "images">> }
  | { ok: false; status: number; error: string };

// Validates whichever fields are given. Images must be
// the user's own library image files.
async function check(userId: string, fields: Fields, creating: boolean): Promise<Checked> {
  const values: Partial<Pick<ElementDoc, "name" | "nameKey" | "description" | "images">> = {};

  if (creating || fields.name !== undefined) {
    const name = typeof fields.name === "string" ? fields.name.trim().replace(/^@/, "") : "";

    if (!ELEMENT_NAME.test(name)) {
      return { ok: false, status: 400, error: `Name: ${ELEMENT_NAME_HINT}` };
    }

    values.name = name;
    values.nameKey = name.toLowerCase();
  }

  if (creating || fields.description !== undefined) {
    const description = typeof fields.description === "string" ? fields.description.trim() : "";

    if (description.length > MAX_ELEMENT_DESCRIPTION) {
      return {
        ok: false,
        status: 400,
        error: `Description must be ${MAX_ELEMENT_DESCRIPTION} characters or fewer`,
      };
    }

    values.description = description;
  }

  if (creating || fields.images !== undefined) {
    const images = Array.isArray(fields.images)
      ? [...new Set(fields.images.filter((url): url is string => typeof url === "string" && url !== ""))]
      : [];

    if (!images.length || images.length > MAX_ELEMENT_IMAGES) {
      return {
        ok: false,
        status: 400,
        error: `Add 1 to ${MAX_ELEMENT_IMAGES} reference images`,
      };
    }

    const owned = await (await libraryFilesCollection()).countDocuments({
      userId,
      kind: "image",
      url: { $in: images },
    });

    if (owned !== images.length) {
      return { ok: false, status: 400, error: "Images must come from your library" };
    }

    values.images = images;
  }

  return { ok: true, values };
}

const DUPLICATE = { ok: false, status: 409, error: "You already have an element with that name" } as const;

export async function listElements(userId: string): Promise<Element[]> {
  const docs = await (await elementsCollection())
    .find({ userId })
    .sort({ nameKey: 1 })
    .toArray();

  return docs.map(toElement);
}

export async function createElement(userId: string, fields: Fields): Promise<ElementResult> {
  const checked = await check(userId, fields, true);
  if (!checked.ok) return checked;

  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    userId,
    ...checked.values,
    createdAt: now,
    updatedAt: now,
  } as ElementDoc;

  try {
    await (await elementsCollection()).insertOne(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) return DUPLICATE;
    throw error;
  }

  return { ok: true, element: toElement(doc) };
}

export async function updateElement(
  userId: string,
  id: string,
  fields: Fields
): Promise<ElementResult> {
  if (!ObjectId.isValid(id)) return { ok: false, status: 404, error: "Element not found" };

  const checked = await check(userId, fields, false);
  if (!checked.ok) return checked;

  try {
    const doc = await (await elementsCollection()).findOneAndUpdate(
      { _id: new ObjectId(id), userId },
      { $set: { ...checked.values, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!doc) return { ok: false, status: 404, error: "Element not found" };
    return { ok: true, element: toElement(doc) };
  } catch (error) {
    if (isDuplicateKeyError(error)) return DUPLICATE;
    throw error;
  }
}

export async function deleteElement(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;

  const result = await (await elementsCollection()).deleteOne({ _id: new ObjectId(id), userId });
  return result.deletedCount === 1;
}

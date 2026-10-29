import { ObjectId } from "mongodb";
import {
  ELEMENT_MEDIA,
  ELEMENT_NAME,
  ELEMENT_NAME_HINT,
  MAX_ELEMENT_DESCRIPTION,
  type Element,
} from "@/lib/element-mentions";
import { currentNames } from "@/lib/names";
import {
  elementsCollection,
  isDuplicateKeyError,
  libraryFilesCollection,
  type ElementDoc,
} from "@/lib/db/mongodb";

// --------------------------------------------------
// ELEMENTS
//
// A user's saved characters, products or objects: a name
// (mentioned in prompts as @name), a description and
// reference files from their media library: images,
// videos and voice clips, at least one in all. Private to
// the user, like the library.
// --------------------------------------------------

function toElement(doc: ElementDoc): Element {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    description: doc.description,
    images: doc.images,
    videos: doc.videos ?? [],
    audios: doc.audios ?? [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export type ElementResult =
  | { ok: true; element: Element }
  | { ok: false; status: number; error: string };

type Fields = { name?: unknown; description?: unknown; images?: unknown; videos?: unknown; audios?: unknown };

type Values = Partial<Pick<ElementDoc, "name" | "nameKey" | "description" | "images" | "videos" | "audios">>;

type Checked = { ok: true; values: Values } | { ok: false; status: number; error: string };

// Validates whichever fields are given. Files must be
// the user's own library files of that kind; current is
// the element being edited (its other lists count
// towards "at least one file").
async function check(
  userId: string,
  fields: Fields,
  current: Pick<ElementDoc, "images" | "videos" | "audios"> | null
): Promise<Checked> {
  const creating = current === null;
  const values: Values = {};

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

  for (const media of ELEMENT_MEDIA) {
    const given = fields[media.list];
    if (!creating && given === undefined) continue;

    const urls = Array.isArray(given)
      ? [...new Set(given.filter((url): url is string => typeof url === "string" && url !== ""))]
      : [];

    if (urls.length > media.max) {
      return { ok: false, status: 400, error: `Up to ${media.max} ${media.many}` };
    }

    if (urls.length) {
      const owned = await (await libraryFilesCollection()).countDocuments({
        userId,
        kind: media.kind,
        url: { $in: urls },
      });

      if (owned !== urls.length) {
        return { ok: false, status: 400, error: `${media.many[0].toUpperCase()}${media.many.slice(1)} must come from your library` };
      }
    }

    values[media.list] = urls;
  }

  const total = ELEMENT_MEDIA.reduce(
    (sum, media) => sum + (values[media.list] ?? current?.[media.list] ?? []).length,
    0
  );

  if (!total) {
    return { ok: false, status: 400, error: "Add at least one image, video or voice clip" };
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

// Every user's elements, newest first, each with who
// made it (the super admin's view; the route checks)
export async function listAllElements(): Promise<Element[]> {
  const docs = await (await elementsCollection()).find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  const { users } = await currentNames([], docs.map((doc) => doc.userId));

  return docs.map((doc) => ({
    ...toElement(doc),
    addedBy: { id: doc.userId, name: users.get(doc.userId) ?? "Deleted user" },
  }));
}

export async function createElement(userId: string, fields: Fields): Promise<ElementResult> {
  const checked = await check(userId, fields, null);
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

  const elements = await elementsCollection();
  const current = await elements.findOne({ _id: new ObjectId(id), userId });
  if (!current) return { ok: false, status: 404, error: "Element not found" };

  const checked = await check(userId, fields, current);
  if (!checked.ok) return checked;

  try {
    const doc = await elements.findOneAndUpdate(
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

// anyOwner: the super admin's delete of another user's
// element (the route checks)
export async function deleteElement(userId: string, id: string, { anyOwner = false } = {}): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;

  const result = await (await elementsCollection()).deleteOne(
    anyOwner ? { _id: new ObjectId(id) } : { _id: new ObjectId(id), userId }
  );
  return result.deletedCount === 1;
}

import { randomUUID } from "crypto";
import {
  isDuplicateKeyError,
  projectsCollection,
  type ProjectDoc,
} from "@/lib/db/mongodb";
import {
  deleteProjectImageFile,
  projectImageUrl,
} from "@/lib/storage/project-images";
import type { PublicProject } from "@/lib/auth/roles";

// --------------------------------------------------
// PROJECTS (MongoDB "projects" collection)
//
// Names are unique case-insensitively (nameKey index).
// Permission checks live in the API routes: only the
// admins and the super admin may call the mutations
// below, and only the super admin may delete.
// --------------------------------------------------

function toPublicProject(doc: ProjectDoc): PublicProject {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    status: doc.status,
    imageUrl: projectImageUrl(doc),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export type ProjectResult =
  | { ok: true; project: PublicProject }
  | { ok: false; status: number; error: string };

function fail(
  status: number,
  error: string
): ProjectResult {
  return { ok: false, status, error };
}

function normalizeProjectName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const name = value.trim().replace(/\s+/g, " ");

  return name.length >= 1 && name.length <= 60
    ? name
    : null;
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;

  const description = value.trim();

  return description.length <= 500 ? description : null;
}

// --------------------------------------------------
// QUERIES
// --------------------------------------------------

export async function listProjects(options?: {
  includeArchived?: boolean;
}): Promise<PublicProject[]> {
  const filter = options?.includeArchived
    ? {}
    : { status: "active" as const };

  const docs = await (await projectsCollection())
    .find(filter)
    .sort({ name: 1 })
    .collation({ locale: "en", strength: 2 })
    .toArray();

  return docs.map(toPublicProject);
}

// Used by /api/generate to reject unknown or archived
// projects (the name comes from the client).
export async function findActiveProjectByName(
  name: unknown
): Promise<PublicProject | null> {
  const normalized = normalizeProjectName(name);

  if (!normalized) return null;

  const doc = await (await projectsCollection()).findOne({
    nameKey: normalized.toLowerCase(),
    status: "active",
  });

  return doc ? toPublicProject(doc) : null;
}

// --------------------------------------------------
// MUTATIONS (permissions enforced by routes)
// --------------------------------------------------

export async function createProject(
  createdBy: string,
  input: { name?: unknown; description?: unknown }
): Promise<ProjectResult> {
  const name = normalizeProjectName(input.name);

  if (!name) {
    return fail(400, "Project name must be 1–60 characters");
  }

  const description = normalizeDescription(
    input.description
  );

  if (description === null) {
    return fail(
      400,
      "Description must be 500 characters or fewer"
    );
  }

  const now = new Date();

  const doc: ProjectDoc = {
    _id: randomUUID(),
    name,
    nameKey: name.toLowerCase(),
    description,
    status: "active",
    image: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await (await projectsCollection()).insertOne(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return fail(409, "A project with this name already exists");
    }

    throw error;
  }

  return { ok: true, project: toPublicProject(doc) };
}

export async function updateProject(
  id: string,
  patch: {
    name?: unknown;
    description?: unknown;
    status?: unknown;
  }
): Promise<ProjectResult> {
  const set: Partial<ProjectDoc> = {};

  if (patch.name !== undefined) {
    const name = normalizeProjectName(patch.name);

    if (!name) {
      return fail(400, "Project name must be 1–60 characters");
    }

    set.name = name;
    set.nameKey = name.toLowerCase();
  }

  if (patch.description !== undefined) {
    const description = normalizeDescription(
      patch.description
    );

    if (description === null) {
      return fail(
        400,
        "Description must be 500 characters or fewer"
      );
    }

    set.description = description;
  }

  if (patch.status !== undefined) {
    if (
      patch.status !== "active" &&
      patch.status !== "archived"
    ) {
      return fail(400, "Invalid status");
    }

    set.status = patch.status;
  }

  set.updatedAt = new Date();

  try {
    const updated = await (
      await projectsCollection()
    ).findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: "after" }
    );

    if (!updated) return fail(404, "Project not found");

    return { ok: true, project: toPublicProject(updated) };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return fail(409, "A project with this name already exists");
    }

    throw error;
  }
}

export async function deleteProject(
  id: string
): Promise<ProjectResult> {
  const deleted = await (
    await projectsCollection()
  ).findOneAndDelete({ _id: id });

  if (!deleted) return fail(404, "Project not found");

  await deleteProjectImageFile(deleted);

  return { ok: true, project: toPublicProject(deleted) };
}

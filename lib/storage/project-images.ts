import { createHash } from "crypto";
import { Readable } from "stream";
import { del, put } from "@vercel/blob";
import { ObjectId } from "mongodb";
import { blobUploadsEnabled } from "@/lib/input-uploads";
import {
  projectImagesBucket,
  projectsCollection,
  type ProjectDoc,
  type ProjectImage,
  type ProjectImageType,
} from "@/lib/mongodb";

// --------------------------------------------------
// PROJECT PHOTOS
//
// One optional cover photo per project, stored in
// Vercel Blob (older ones: GridFS "projectImages"),
// always served through /api/projects/[id]/image. The
// type is decided by
// the file's magic bytes, never the client's claim, and
// SVG is not accepted (it can carry script).
// --------------------------------------------------

export const PROJECT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Changes whenever the photo does (cache busting / ETag)
export function projectImageVersion(image: ProjectImage): string {
  return image.blobUrl
    ? createHash("sha256").update(image.blobUrl).digest("hex").slice(0, 24)
    : (image.fileId?.toHexString() ?? "none");
}

export function projectImageUrl(
  doc: Pick<ProjectDoc, "_id" | "image">
): string | null {
  if (!doc.image) return null;

  return `/api/projects/${encodeURIComponent(doc._id)}/image?v=${projectImageVersion(doc.image)}`;
}

export function sniffImageType(
  bytes: Uint8Array
): ProjectImageType | null {
  const starts = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every(
      (byte, index) => bytes[offset + index] === byte
    );

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";

  // "GIF87a" / "GIF89a"
  if (
    starts([0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  // "RIFF" .... "WEBP"
  if (
    starts([0x52, 0x49, 0x46, 0x46]) &&
    starts([0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }

  return null;
}

export type ProjectImageResult =
  | { ok: true; imageUrl: string | null }
  | { ok: false; status: number; error: string };

// Removes a photo's bytes from wherever they live
async function deleteImageFile(image: ProjectImage) {
  try {
    if (image.blobUrl) await del(image.blobUrl);
    if (image.fileId) await (await projectImagesBucket()).delete(image.fileId);
  } catch (error) {
    // Already gone is fine; anything else is only an
    // orphaned file, so log it rather than fail the request
    console.error("Delete project image file error:", error);
  }
}

const EXTENSIONS: Record<ProjectImageType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function setProjectImage(
  projectId: string,
  bytes: Uint8Array
): Promise<ProjectImageResult> {
  if (!bytes.length) {
    return { ok: false, status: 400, error: "The file is empty" };
  }

  if (bytes.length > PROJECT_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Photo must be 5 MB or smaller",
    };
  }

  const contentType = sniffImageType(bytes);

  if (!contentType) {
    return {
      ok: false,
      status: 415,
      error: "Photo must be a PNG, JPEG, WebP or GIF image",
    };
  }

  const projects = await projectsCollection();

  // Cheap check before writing any bytes
  const exists = await projects.countDocuments(
    { _id: projectId },
    { limit: 1 }
  );

  if (!exists) {
    return { ok: false, status: 404, error: "Project not found" };
  }

  // Write the new file first, then swap the pointer, then
  // remove the old file: a failure at any step leaves the
  // project pointing at a complete image.
  const stored: Pick<ProjectImage, "blobUrl" | "fileId"> = {};

  if (blobUploadsEnabled()) {
    const blob = await put(
      `project-images/${projectId.replace(/[^\w.-]+/g, "_")}${EXTENSIONS[contentType]}`,
      Buffer.from(bytes),
      { access: "public", addRandomSuffix: true, contentType }
    );
    stored.blobUrl = blob.url;
  } else {
    const bucket = await projectImagesBucket();
    const fileId = new ObjectId();

    await new Promise<void>((resolve, reject) => {
      const upload = bucket.openUploadStream(
        `project-${projectId}`,
        {
          id: fileId,
          metadata: { projectId, contentType },
        }
      );

      upload.once("finish", () => resolve());
      upload.once("error", reject);
      upload.end(Buffer.from(bytes));
    });

    stored.fileId = fileId;
  }

  const image: ProjectImage = {
    blobUrl: stored.blobUrl ?? null,
    fileId: stored.fileId ?? null,
    contentType,
    size: bytes.length,
    updatedAt: new Date(),
  };

  const previous = await projects.findOneAndUpdate(
    { _id: projectId },
    { $set: { image, updatedAt: image.updatedAt } },
    { returnDocument: "before" }
  );

  if (!previous) {
    // Deleted while we were uploading
    await deleteImageFile(image);

    return { ok: false, status: 404, error: "Project not found" };
  }

  if (previous.image) {
    await deleteImageFile(previous.image);
  }

  return {
    ok: true,
    imageUrl: projectImageUrl({ _id: projectId, image }),
  };
}

export async function removeProjectImage(
  projectId: string
): Promise<ProjectImageResult> {
  const previous = await (
    await projectsCollection()
  ).findOneAndUpdate(
    { _id: projectId },
    { $set: { image: null, updatedAt: new Date() } },
    { returnDocument: "before" }
  );

  if (!previous) {
    return { ok: false, status: 404, error: "Project not found" };
  }

  if (previous.image) {
    await deleteImageFile(previous.image);
  }

  return { ok: true, imageUrl: null };
}

// Called when a project is deleted
export async function deleteProjectImageFile(
  project: Pick<ProjectDoc, "image">
) {
  if (project.image) {
    await deleteImageFile(project.image);
  }
}

export async function getProjectImage(
  projectId: string
): Promise<ProjectImage | null> {
  const project = await (await projectsCollection()).findOne(
    { _id: projectId },
    { projection: { image: 1 } }
  );

  return project?.image ?? null;
}

// The photo's bytes, from Blob or (older photos) GridFS
export async function openProjectImage(
  image: ProjectImage
): Promise<ReadableStream<Uint8Array> | null> {
  if (image.blobUrl) {
    const response = await fetch(image.blobUrl, { cache: "no-store" });

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Blob read failed: ${response.status}`);
    }

    return response.body;
  }

  if (!image.fileId) return null;

  return Readable.toWeb(
    (await projectImagesBucket()).openDownloadStream(image.fileId)
  ) as ReadableStream<Uint8Array>;
}

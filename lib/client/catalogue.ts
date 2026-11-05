import { fetchJson } from "@/lib/client/http";
import { safeFileName, uploadToBlob } from "@/lib/client/upload";
import type {
  Crop,
  InputSlot,
  ProductSummary,
  PublicAsset,
  PublicProduct,
  PublicTemplate,
} from "@/lib/catalogue/shared";

// --------------------------------------------------
// CATALOGUE: browser helpers for /api/catalogue/*
// --------------------------------------------------

export type Library = { assets: PublicAsset[]; templates: PublicTemplate[]; canEdit: boolean };

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const catalogueApi = {
  library: (all = false) => fetchJson<Library>(`/api/catalogue/library${all ? "?all=1" : ""}`),
  createAsset: (body: Partial<PublicAsset>) =>
    fetchJson<{ asset: PublicAsset }>("/api/catalogue/library", json("POST", body)),
  updateAsset: (id: string, body: Partial<PublicAsset>) =>
    fetchJson<{ asset: PublicAsset }>(`/api/catalogue/assets/${id}`, json("PATCH", body)),
  deleteAsset: (id: string) => fetchJson(`/api/catalogue/assets/${id}`, { method: "DELETE" }),
  createTemplate: (body: Partial<PublicTemplate>) =>
    fetchJson<{ template: PublicTemplate }>("/api/catalogue/templates", json("POST", body)),
  updateTemplate: (id: string, body: Partial<PublicTemplate>) =>
    fetchJson<{ template: PublicTemplate }>(`/api/catalogue/templates/${id}`, json("PATCH", body)),
  deleteTemplate: (id: string) => fetchJson(`/api/catalogue/templates/${id}`, { method: "DELETE" }),

  products: () => fetchJson<{ products: ProductSummary[] }>("/api/catalogue/products"),
  createProduct: (body: { name: string; sku?: string; category?: string; gender?: string; notes?: string; project: string }) =>
    fetchJson<{ product: PublicProduct }>("/api/catalogue/products", json("POST", body)),
  product: (id: string) => fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}`),
  // Any of: name, sku, category, gender, notes, project (name),
  // templateId, modelId, poseId, backgroundId, accessoryIds,
  // imageModel, resolution, inputs { slot: url | null }
  updateProduct: (id: string, body: Record<string, unknown>) =>
    fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}`, json("PATCH", body)),
  deleteProduct: (id: string) => fetchJson(`/api/catalogue/products/${id}`, { method: "DELETE" }),
  generate: (id: string, feedback = "") =>
    fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}/generate`, json("POST", { feedback })),
  // Optional: only some shots, and a pose / background
  // per shot ({ shotId: assetId })
  approve: (
    id: string,
    body: {
      shotIds?: string[];
      poseOverrides?: Record<string, string>;
      backgroundOverrides?: Record<string, string>;
    } = {},
  ) => fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}/approve`, json("POST", body)),
  regenerate: (id: string, body: { shotId: string; feedback?: string; poseId?: string | null; backgroundId?: string | null }) =>
    fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}/regenerate`, json("POST", body)),
  // crop null: show and download the whole image again
  crop: (id: string, body: { shotId: string; generationId: string; crop: Crop | null }) =>
    fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}/crop`, json("POST", body)),
  select: (id: string, shotId: string, generationId: string) =>
    fetchJson<{ product: PublicProduct }>(`/api/catalogue/products/${id}/select`, json("POST", { shotId, generationId })),
};

// Uploads straight to Blob; returns the public URL
export function uploadLibraryImage(file: File, onProgress?: (percent: number | null) => void) {
  return uploadToBlob(`catalogue/library/${safeFileName(file)}`, "/api/catalogue/upload", file, onProgress);
}

export function uploadProductImage(
  product: Pick<PublicProduct, "id" | "owner">,
  slot: InputSlot,
  file: File,
  onProgress?: (percent: number | null) => void,
) {
  return uploadToBlob(
    `catalogue/${product.owner.id}/products/${product.id}/inputs/${slot}-${safeFileName(file)}`,
    "/api/catalogue/upload",
    file,
    onProgress,
  );
}

// Saves an image under a clean name (cross-origin links
// ignore the download attribute, so fetch it first);
// with a crop, only that part, at full resolution
export async function downloadImage(url: string, name: string, crop: Crop | null = null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Couldn't fetch the image");
  let blob = await response.blob();
  if (crop) blob = await cropBlob(blob, crop);
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name.replace(/[^\w.-]+/g, "_")}.${ext}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

// The cropped part of an image, same format (JPEG at
// high quality for anything that isn't PNG)
async function cropBlob(blob: Blob, crop: Crop): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const sx = Math.round(crop.x * bitmap.width);
  const sy = Math.round(crop.y * bitmap.height);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(crop.w * bitmap.width)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(crop.h * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const type = blob.type.includes("png") ? "image/png" : "image/jpeg";
  return new Promise((resolve, reject) =>
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Couldn't crop the image"))), type, 0.95),
  );
}

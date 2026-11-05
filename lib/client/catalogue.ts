import { fetchJson } from "@/lib/client/http";
import { safeFileName, uploadToBlob } from "@/lib/client/upload";
import type {
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
// ignore the download attribute, so fetch it first)
export async function downloadImage(url: string, name: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name.replace(/[^\w.-]+/g, "_")}.${ext}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

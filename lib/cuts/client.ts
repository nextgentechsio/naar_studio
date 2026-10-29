import { fetchJson } from "@/lib/client/http";
import { safeFileName, uploadToBlob } from "@/lib/client/upload";
import { cutExportsFolder, cutMediaFolder, type CutAsset, type CutDetail, type CutSummary } from "@/lib/cuts/types";

// --------------------------------------------------
// NAAR CUTS: API CALLS (browser)
// --------------------------------------------------

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listCuts() {
  return fetchJson<{ cuts: CutSummary[]; storage: boolean }>("/api/cuts");
}

export async function createCut(name?: string) {
  return (await fetchJson<{ cut: CutDetail }>("/api/cuts", json(name ? { name } : {}))).cut;
}

export async function getCut(id: string) {
  return (await fetchJson<{ cut: CutDetail }>(`/api/cuts/${encodeURIComponent(id)}`)).cut;
}

export type CutSave = {
  version: number;
  name?: string;
  timeline?: unknown;
  durationMs?: number;
  posterUrl?: string | null;
};

export async function saveCut(id: string, body: CutSave) {
  return (await fetchJson<{ cut: CutDetail }>(`/api/cuts/${encodeURIComponent(id)}`, json(body, "PATCH"))).cut;
}

export async function deleteCut(id: string) {
  await fetchJson(`/api/cuts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listAssets(cutId: string) {
  return (await fetchJson<{ assets: CutAsset[] }>(`/api/cuts/${encodeURIComponent(cutId)}/assets`)).assets;
}

// A run's output or an element's file, copied into the
// cut's own folder on the server
export async function addGenerationAsset(cutId: string, generationId: string) {
  return (
    await fetchJson<{ asset: CutAsset }>(
      `/api/cuts/${encodeURIComponent(cutId)}/assets`,
      json({ source: "generation", id: generationId })
    )
  ).asset;
}

export async function addElementAsset(cutId: string, url: string) {
  return (
    await fetchJson<{ asset: CutAsset }>(`/api/cuts/${encodeURIComponent(cutId)}/assets`, json({ source: "element", url }))
  ).asset;
}

// A file from the computer, or a finished export,
// uploaded straight to the cut's folder
export async function uploadCutFile(
  userId: string,
  cutId: string,
  file: File,
  kind: "upload" | "export",
  onProgress?: (percent: number | null) => void
) {
  const folder = kind === "export" ? cutExportsFolder(userId, cutId) : cutMediaFolder(userId, cutId);
  const url = await uploadToBlob(`${folder}${safeFileName(file)}`, "/api/cuts/upload", file, onProgress);
  return (
    await fetchJson<{ asset: CutAsset }>(
      `/api/cuts/${encodeURIComponent(cutId)}/assets`,
      json({ source: kind, url, name: file.name })
    )
  ).asset;
}

export async function updateAsset(
  cutId: string,
  assetId: string,
  body: { durationMs?: number; width?: number; height?: number; peaks?: number[] }
) {
  return (
    await fetchJson<{ asset: CutAsset }>(
      `/api/cuts/${encodeURIComponent(cutId)}/assets/${encodeURIComponent(assetId)}`,
      json(body, "PATCH")
    )
  ).asset;
}

export async function deleteAsset(cutId: string, assetId: string) {
  await fetchJson(`/api/cuts/${encodeURIComponent(cutId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

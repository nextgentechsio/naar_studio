// --------------------------------------------------
// NAAR CUTS: WHAT THE BROWSER SEES
//
// Shared by the API routes and the editor.
// --------------------------------------------------

export type CutSummary = {
  id: string;
  name: string;
  durationMs: number;
  posterUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CutDetail = CutSummary & {
  timeline: unknown;
  version: number;
};

export type CutAssetKind = "video" | "image" | "audio" | "export";

export type CutAsset = {
  id: string;
  url: string;
  kind: CutAssetKind;
  contentType: string;
  size: number;
  name: string;
  source: "generation" | "element" | "upload" | "export";
  // Where it came from: a generation id, or the element
  // file's URL
  sourceRef: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  peaks: number[] | null;
  createdAt: string;
};

export const CUT_NAME_MAX = 80;
// The saved timeline JSON (clips are small: far below)
export const CUT_TIMELINE_MAX_BYTES = 2 * 1024 * 1024;
// Media copied or uploaded into a project, and exports
export const CUT_MEDIA_MAX_BYTES = 500 * 1024 * 1024;
export const CUT_EXPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const CUT_PEAKS_MAX = 4000;

// Blob folder of one project: cuts/<userId>/<cutId>/
export function cutFolder(userId: string, cutId: string) {
  return `cuts/${userId}/${cutId}/`;
}

export function cutMediaFolder(userId: string, cutId: string) {
  return `${cutFolder(userId, cutId)}media/`;
}

export function cutExportsFolder(userId: string, cutId: string) {
  return `${cutFolder(userId, cutId)}exports/`;
}

// "video/mp4" → "video"; null for anything else
export function cutKindOf(contentType: string): "video" | "image" | "audio" | null {
  const family = contentType.split(";")[0].trim().toLowerCase().split("/")[0];
  return family === "video" || family === "image" || family === "audio" ? family : null;
}

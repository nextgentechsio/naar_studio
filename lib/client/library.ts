import { fetchJson } from "@/lib/client/http";
import { safeFileName, uploadToBlob } from "@/lib/client/upload";
import type { LibraryFile, LibraryKind } from "@/lib/storage/media-library";

// --------------------------------------------------
// MEDIA LIBRARY (browser only, see lib/storage/media-library.ts)
//
// Uploads go to the user's library folder on Vercel
// Blob and are listed for reuse in later runs. Without
// Blob on the server, the library is off and uploads go
// the old way (lib/client/upload.ts).
// --------------------------------------------------

export type { LibraryFile, LibraryKind };

type LibraryInfo = { enabled: boolean; folder: string | null; files: LibraryFile[] };

let info: Promise<LibraryInfo> | null = null;

// Whether it's on, and the user's folder (asked once)
function libraryInfo(): Promise<LibraryInfo> {
  info ??= fetchJson<LibraryInfo>("/api/library").catch(() => {
    // Ask again next time
    info = null;
    return { enabled: false, folder: null, files: [] };
  });

  return info;
}

// Lists showing the library refresh when it changes
const listeners = new Set<() => void>();

export function onLibraryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const changed = () => listeners.forEach((listener) => listener());

export async function fetchLibrary(kind: LibraryKind): Promise<LibraryInfo> {
  return fetchJson<LibraryInfo>(`/api/library?kind=${kind}`);
}

// Saves a file to the library and returns its URL, or
// null when the library is off
export async function uploadToLibrary(
  file: File,
  onProgress?: (percent: number | null) => void
): Promise<string | null> {
  const { enabled, folder } = await libraryInfo();
  if (!enabled || !folder) return null;

  let url: string;

  try {
    url = await uploadToBlob(`${folder}${safeFileName(file)}`, "/api/library/upload", file, onProgress);
  } catch (err) {
    // Maybe another account signed in here since: ask for
    // the folder again next time
    info = null;
    throw err;
  }

  const { file: saved } = await fetchJson<{ file: LibraryFile }>("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, name: file.name }),
  });

  changed();
  return saved.url;
}

export async function deleteFromLibrary(id: string): Promise<void> {
  await fetchJson(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
  changed();
}

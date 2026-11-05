import { del, list } from "@vercel/blob";
import { blobUploadsEnabled } from "@/lib/storage/input-uploads";
import { catalogueCollections, CATALOGUE_PREFIX, libraryFolder } from "./db";

// --------------------------------------------------
// CATALOGUE FILES: everything Catalogue stores lives in
// its own Blob folder, apart from the rest of the studio:
//
//   catalogue/library/…                      model / pose /
//                                            background photos
//   catalogue/<userId>/products/<id>/inputs/ garment photos
//   catalogue/<userId>/products/<id>/shots/  finished images
//
// Output retention never touches catalogue/ (it only
// sweeps outputs/ and inputs/), so these stay until
// Catalogue removes them: a replaced or deleted photo
// right away, an abandoned upload after a grace period,
// a product's whole folder when the product is deleted.
// (Each image's History copy in outputs/ expires with
// retention like any other generation's.)
// --------------------------------------------------

const HOUR = 60 * 60 * 1000;
// Uploads not saved to anything yet (a dialog still open)
const LIBRARY_GRACE_MS = 24 * HOUR;
export const INPUT_GRACE_MS = HOUR;

// Tidies one catalogue folder: deletes the files in `drop`
// plus any file no record uses (`keep`) that's older than
// `graceMs`. Only ever lists and deletes inside the folder.
// Best effort: a failure is logged, never thrown.
export async function tidyFolder(
  folder: string,
  keep: Iterable<string | null | undefined>,
  options: { drop?: Iterable<string | null | undefined>; graceMs: number },
): Promise<number> {
  if (!blobUploadsEnabled() || !folder.startsWith(CATALOGUE_PREFIX) || folder.includes("..")) return 0;
  const kept = new Set([...keep].filter(Boolean));
  const dropped = new Set([...(options.drop ?? [])].filter((url): url is string => Boolean(url) && !kept.has(url!)));
  const cutoff = Date.now() - options.graceMs;
  let removed = 0;

  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: folder, cursor, limit: 1000 });
      const doomed = page.blobs
        .filter(
          (blob) =>
            blob.pathname.startsWith(folder) &&
            (dropped.has(blob.url) || (!kept.has(blob.url) && new Date(blob.uploadedAt).getTime() < cutoff)),
        )
        .map((blob) => blob.url);
      if (doomed.length) {
        await del(doomed);
        removed += doomed.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error("Catalogue: tidy failed:", folder, error);
  }
  return removed;
}

// The library folder against every library item's photo
export async function tidyLibrary(drop: (string | null | undefined)[] = []): Promise<number> {
  const { assets } = await catalogueCollections();
  const used = await assets.distinct("imageUrl", { imageUrl: { $ne: null } });
  return tidyFolder(libraryFolder(), used as string[], { drop, graceMs: LIBRARY_GRACE_MS });
}

const globalForTidy = globalThis as unknown as { catalogueLibraryTidiedAt?: number };

// At most once an hour per server process (abandoned
// uploads); call after a response
export async function maybeTidyLibrary(): Promise<void> {
  const last = globalForTidy.catalogueLibraryTidiedAt ?? 0;
  if (Date.now() - last < HOUR) return;
  globalForTidy.catalogueLibraryTidiedAt = Date.now();
  await tidyLibrary();
}

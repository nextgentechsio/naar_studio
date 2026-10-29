import type { Collection } from "mongodb";
import { getDb } from "@/lib/db/mongodb";

// --------------------------------------------------
// NAAR CUTS: DATA (MongoDB "cuts" and "cutAssets")
//
// Kept apart from the rest of the studio: its own
// collections, indexed here (not in lib/db/mongodb.ts's
// setup), and its own Blob folder (lib/cuts/storage.ts).
// --------------------------------------------------

// An edit project. The timeline is the editor's own JSON
// (lib/cuts/timeline.ts), saved whole; `version` goes up
// on every save so two tabs can't overwrite each other.
export type CutDoc = {
  _id: string;
  userId: string;
  name: string;
  timeline: unknown;
  version: number;
  durationMs: number;
  // A frame for the project list (an image asset's URL)
  posterUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CutAssetKind = "video" | "image" | "audio" | "export";

export type CutAssetSource =
  | { type: "generation"; id: string }
  | { type: "element"; url: string }
  | { type: "upload" }
  | { type: "export" };

// A file a project uses: its own copy in Blob
// (cuts/<userId>/<cutId>/), whatever it came from
export type CutAssetDoc = {
  _id: string;
  cutId: string;
  userId: string;
  url: string;
  pathname: string;
  kind: CutAssetKind;
  contentType: string;
  size: number;
  name: string;
  source: CutAssetSource;
  // "generation:<id>", "element:<url>" or the pathname:
  // the same file is copied once per project
  sourceKey: string;
  // Measured in the browser once (lib/cuts/media.ts)
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  // Waveform: peak levels 0–255, evenly spaced
  peaks?: number[] | null;
  createdAt: Date;
};

const globalForCuts = globalThis as unknown as {
  cutsIndexesPromise?: Promise<void>;
};

async function cutsDb() {
  const db = await getDb();

  if (!globalForCuts.cutsIndexesPromise) {
    globalForCuts.cutsIndexesPromise = Promise.all([
      db.collection<CutDoc>("cuts").createIndexes([{ key: { userId: 1, updatedAt: -1, _id: -1 } }]),
      db.collection<CutAssetDoc>("cutAssets").createIndexes([
        { key: { cutId: 1, sourceKey: 1 }, unique: true },
        { key: { cutId: 1, createdAt: 1 } },
      ]),
    ])
      .then(() => undefined)
      .catch((error) => {
        // Try again on the next call
        globalForCuts.cutsIndexesPromise = undefined;
        throw error;
      });
  }

  await globalForCuts.cutsIndexesPromise;
  return db;
}

export async function cutsCollection(): Promise<Collection<CutDoc>> {
  return (await cutsDb()).collection<CutDoc>("cuts");
}

export async function cutAssetsCollection(): Promise<Collection<CutAssetDoc>> {
  return (await cutsDb()).collection<CutAssetDoc>("cutAssets");
}

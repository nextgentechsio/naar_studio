import { findCatalogModel } from "@/lib/replicate/catalog";

// --------------------------------------------------
// REPLICATE MODEL LISTINGS (server side)
//
// Shapes Replicate's model objects into what the model
// browser needs, and caches collection lists briefly:
// they change rarely and every Generate page asks.
// --------------------------------------------------

export type BrowsableModel = {
  id: string;
  owner: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  runCount: number;
  // In our priced catalog (spend tracked exactly)
  approved: boolean;
};

type RawModel = {
  owner?: unknown;
  name?: unknown;
  description?: unknown;
  cover_image_url?: unknown;
  run_count?: unknown;
};

export function toBrowsable(raw: unknown): BrowsableModel | null {
  const model = (raw ?? {}) as RawModel;

  if (typeof model.owner !== "string" || typeof model.name !== "string") {
    return null;
  }

  const id = `${model.owner}/${model.name}`;

  return {
    id,
    owner: model.owner,
    name: model.name,
    description:
      typeof model.description === "string" ? model.description.slice(0, 300) : null,
    // Only https images (shown in our page)
    coverImageUrl:
      typeof model.cover_image_url === "string" &&
      model.cover_image_url.startsWith("https://")
        ? model.cover_image_url
        : null,
    runCount: typeof model.run_count === "number" ? model.run_count : 0,
    approved: Boolean(findCatalogModel(id)),
  };
}

// Most-used first, approved models before others
export function sortModels(models: BrowsableModel[]): BrowsableModel[] {
  return [...models].sort(
    (a, b) => Number(b.approved) - Number(a.approved) || b.runCount - a.runCount
  );
}

// Tiny time-based cache (per server process)
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 10 * 60 * 1000;

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;

  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const COLLECTION_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

// --------------------------------------------------
// LAST-SEEN DATA (browser only)
//
// The latest response for each request, kept in memory
// for this tab. Pages show it at once when revisited and
// refresh it in the background, instead of starting
// blank every time. Sign-out reloads the page, which
// empties it, so nothing carries over between accounts.
// --------------------------------------------------

const MAX_ENTRIES = 100;

const store = new Map<string, unknown>();

export function readCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writeCache(key: string, value: unknown) {
  // Re-insert so the oldest entry is the first one
  store.delete(key);
  store.set(key, value);

  if (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value!);
  }
}

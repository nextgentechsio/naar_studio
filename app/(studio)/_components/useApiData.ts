"use client";

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/client/cache";
import { errorMessage, logRequestError } from "@/lib/client/http";

// Loads data for `key`, again whenever the key changes
// (e.g. new filters). Data loaded for this key before (an
// earlier visit) shows at once while the fresh copy
// loads. Otherwise the previous key's data stays up,
// marked `stale`, until the new one arrives; `refreshing`
// is true while anything is loading. `data` is null only
// when there's nothing to show; `error` holds a readable
// message. State is only set in the promise callbacks.
export function useApiData<T>(
  key: string,
  load: () => Promise<T>,
  fallbackError: string
): {
  data: T | null;
  error: string;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
} {
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
    done: boolean;
  }>(() => ({ key, data: readCache<T>(key) ?? null, error: "", done: false }));

  useEffect(() => {
    let cancelled = false;

    load()
      .then((value) => {
        writeCache(key, value);
        if (!cancelled) setState({ key, data: value, error: "", done: true });
      })
      .catch((err) => {
        logRequestError(err);
        if (!cancelled) {
          setState((previous) => ({
            key,
            // Never show another key's data as this one's
            data: previous.key === key ? previous.data : (readCache<T>(key) ?? null),
            error: errorMessage(err, fallbackError),
            done: true,
          }));
        }
      });

    return () => {
      cancelled = true;
    };
    // `load` reads the same inputs the key is built from
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state.key === key;
  const cached = current ? undefined : readCache<T>(key);
  const data = current ? state.data : (cached ?? state.data);
  const pending = !current || !state.done;

  return {
    data,
    error: current ? state.error : "",
    loading: pending && data === null,
    refreshing: pending && data !== null,
    stale: !current && cached === undefined && data !== null,
  };
}

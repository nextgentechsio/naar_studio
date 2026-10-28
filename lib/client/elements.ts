"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchJson, logRequestError } from "@/lib/client/http";
import type { Element } from "@/lib/element-mentions";

// --------------------------------------------------
// ELEMENTS (browser only, see lib/elements.ts)
//
// One copy of the user's elements per tab, shared by the
// Elements page and the prompt's @ list, refreshed after
// every change. Sign-out reloads the page, which empties
// it.
// --------------------------------------------------

export type { Element };

type State = { elements: Element[] | null; error: string };

let state: State = { elements: null, error: "" };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

function reloadElements(): Promise<void> {
  loading ??= fetchJson<{ elements: Element[] }>("/api/elements")
    .then((data) => set({ elements: data.elements, error: "" }))
    .catch((err) => {
      logRequestError(err);
      set({ elements: state.elements ?? [], error: "Couldn't load your elements." });
    })
    .finally(() => {
      loading = null;
    });

  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// The elements, loading them first if needed (e.g. a
// run sent before the @ list was ever opened)
export async function currentElements(): Promise<Element[]> {
  if (state.elements === null) await reloadElements();
  return state.elements ?? [];
}

// Loads on first use; null until loaded
export function useElements(): State {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  );

  useEffect(() => {
    if (state.elements === null) void reloadElements();
  }, []);

  return current;
}

export type ElementFields = { name: string; description: string; images: string[] };

export async function saveElement(id: string | null, fields: ElementFields): Promise<Element> {
  const { element } = await fetchJson<{ element: Element }>(
    id ? `/api/elements/${encodeURIComponent(id)}` : "/api/elements",
    {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }
  );

  await reloadElements();
  return element;
}

export async function removeElement(id: string): Promise<void> {
  await fetchJson(`/api/elements/${encodeURIComponent(id)}`, { method: "DELETE" });
  await reloadElements();
}

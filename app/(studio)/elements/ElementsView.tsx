"use client";

import { useState } from "react";
import { useElements, type Element } from "@/lib/client/elements";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, EmptyState, inputClass, PageHeader } from "@/app/components/ui/primitives";
import ElementDialog from "./ElementDialog";

// --------------------------------------------------
// ELEMENTS PAGE
//
// The user's saved characters, products and objects.
// Typing @ in a prompt lists them.
// --------------------------------------------------

export default function ElementsView() {
  const { elements, error } = useElements();
  // undefined: closed; null: new
  const [editing, setEditing] = useState<Element | null | undefined>(undefined);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = (elements ?? []).filter(
    (element) =>
      element.name.toLowerCase().includes(needle) || element.description.toLowerCase().includes(needle)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Elements"
        description="Characters, products and objects you reuse. Type @ in any prompt to add one to a run."
        actions={
          <Button variant="primary" icon="at" onClick={() => setEditing(null)}>
            New element
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}

      {elements && elements.length > 0 && (
        <div className="relative max-w-sm">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${elements.length} element${elements.length === 1 ? "" : "s"}`}
            aria-label="Search elements"
            className={cx(inputClass, "pl-9")}
          />
        </div>
      )}

      {elements === null ? (
        <ul aria-label="Loading elements" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="overflow-hidden rounded-2xl border border-line">
              <div className="ui-skeleton aspect-square" />
              <div className="space-y-2 p-3">
                <div className="ui-skeleton h-3.5 w-1/2 rounded" />
                <div className="ui-skeleton h-3 w-3/4 rounded" />
              </div>
            </li>
          ))}
        </ul>
      ) : elements.length === 0 ? (
        <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
          <EmptyState
            icon="at"
            title="No elements yet"
            description="Save a character, product or object with a few reference images. Then type @ in a prompt and pick it: its images go in with the run."
            action={
              <Button variant="primary" icon="at" onClick={() => setEditing(null)}>
                Create your first element
              </Button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">Nothing matches &ldquo;{query}&rdquo;</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((element, index) => (
            <li key={element.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
              <ElementCard element={element} onOpen={() => setEditing(element)} />
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined && <ElementDialog element={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function ElementCard({ element, onOpen }: { element: Element; onOpen: () => void }) {
  const [cover, ...rest] = element.images;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full overflow-hidden rounded-2xl border border-line bg-surface text-left transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="relative block aspect-square overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* The other references, fanned in the corner */}
        {rest.length > 0 && (
          <span className="absolute bottom-2.5 right-2.5 flex">
            {rest.slice(0, 3).map((url, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                className="-ml-3 h-9 w-9 rounded-lg border-2 border-surface object-cover shadow-md transition-transform duration-300 first:ml-0 group-hover:-translate-y-0.5"
                style={{ transitionDelay: `${index * 40}ms` }}
              />
            ))}
            {rest.length > 3 && (
              <span className="-ml-3 flex h-9 w-9 items-center justify-center rounded-lg border-2 border-surface bg-black/80 text-xs font-medium text-white">
                +{rest.length - 3}
              </span>
            )}
          </span>
        )}

        <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-all duration-300 group-hover:opacity-100">
          <Icon name="settings" size={11} />
          Edit
        </span>
      </span>

      <span className="block p-3">
        <span className="block truncate text-sm font-semibold text-fg">
          <span className="text-accent">@</span>
          {element.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
          {element.description || `${element.images.length} reference image${element.images.length === 1 ? "" : "s"}`}
        </span>
      </span>
    </button>
  );
}

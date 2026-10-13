"use client";

import { useEffect, useState } from "react";
import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
import { Icon } from "@/app/components/ui/Icon";
import {
  Alert,
  Badge,
  cx,
  inputClass,
  Spinner,
} from "@/app/components/ui/primitives";
import { errorMessage, fetchJson } from "@/lib/client/http";
import type { BrowsableModel } from "@/lib/replicate-models";

// --------------------------------------------------
// BROWSE ALL REPLICATE MODELS
//
// Search all of Replicate, or browse its curated
// categories. Models outside the approved list run fine
// but have no price on file, so their spend is recorded
// as "unpriced"; every card says which kind it is.
// --------------------------------------------------

type Collection = { slug: string; name: string; description: string | null };

const DEFAULT_COLLECTION = "official";

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function ModelBrowser() {
  const {
    model,
    chooseModel,
    showOtherModels,
    toggleOtherModels,
    search,
    setSearch,
    searchResults,
    searchResultsFor,
    searching,
  } = useGenerate();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState(DEFAULT_COLLECTION);
  const [browse, setBrowse] = useState<{
    slug: string;
    models?: BrowsableModel[];
    error?: string;
  }>({ slug: "" });

  // Category list, once the panel is opened
  useEffect(() => {
    if (!showOtherModels || collections.length) return;

    let cancelled = false;

    fetchJson<{ collections?: Collection[] }>("/api/models/collections")
      .then((data) => {
        if (!cancelled) setCollections(data.collections ?? []);
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, [showOtherModels, collections.length]);

  // Models in the chosen category (state set in callbacks)
  useEffect(() => {
    if (!showOtherModels) return;

    let cancelled = false;

    fetchJson<{ models?: BrowsableModel[] }>(
      `/api/models/collections/${encodeURIComponent(collection)}`
    )
      .then((data) => {
        if (!cancelled) setBrowse({ slug: collection, models: data.models ?? [] });
      })
      .catch((err) => {
        if (!cancelled) {
          setBrowse({
            slug: collection,
            error: errorMessage(err, "Couldn't load this category."),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showOtherModels, collection]);

  const query = search.trim();
  const searchingMode = Boolean(query) && search !== model;

  const browseLoading = browse.slug !== collection;
  const shown = searchingMode
    ? searchResultsFor === query
      ? searchResults
      : []
    : (browse.models ?? []);
  // Pending until results for exactly this query arrive
  // (no "0 results" flash while the user is typing)
  const loading = searchingMode
    ? searching || searchResultsFor !== query
    : browseLoading;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        type="button"
        aria-expanded={showOtherModels}
        onClick={toggleOtherModels}
        className="flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"
      >
        <Icon
          name="chevronDown"
          size={16}
          className={cx("transition-transform", showOtherModels ? "" : "-rotate-90")}
        />
        Browse all Replicate models
      </button>

      {showOtherModels && (
        <div className="mt-3 space-y-3">
          <Alert tone="warning">
            Models marked <strong>Unpriced</strong> run normally, but Replicate
            doesn&apos;t report their cost, so their spend shows as unpriced in
            Expenses.
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search all of Replicate, e.g. flux, whisper, upscale"
                aria-label="Search Replicate models"
                maxLength={100}
                className={cx(inputClass, "pl-9")}
              />
            </div>

            <select
              aria-label="Category"
              value={collection}
              onChange={(event) => {
                setCollection(event.target.value);
                setSearch("");
              }}
              className={cx(inputClass, "sm:w-60 xl:w-full")}
            >
              {!collections.some((item) => item.slug === DEFAULT_COLLECTION) && (
                <option value={DEFAULT_COLLECTION}>Official models</option>
              )}
              {collections.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-fg-subtle" aria-live="polite">
            {loading
              ? "Loading…"
              : searchingMode
                ? `${shown.length} result${shown.length === 1 ? "" : "s"} for “${query}”`
                : `${shown.length} model${shown.length === 1 ? "" : "s"} in ${
                    collections.find((item) => item.slug === collection)?.name ??
                    "Official models"
                  }`}
          </p>

          {!searchingMode && browse.error && browse.slug === collection && (
            <Alert>{browse.error}</Alert>
          )}

          {loading && !shown.length ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner /> Loading models…
            </p>
          ) : shown.length ? (
            <ul
              className={cx(
                "grid max-h-[28rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1",
                loading && "opacity-60"
              )}
            >
              {shown.map((item) => (
                <li key={item.id}>
                  <ModelCard
                    item={item}
                    selected={model === item.id}
                    onSelect={() =>
                      chooseModel(item.id, { fromSearch: searchingMode })
                    }
                  />
                </li>
              ))}
            </ul>
          ) : searchingMode ? (
            <p className="text-sm text-fg-subtle">No models match “{query}”.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ModelCard({
  item,
  selected,
  onSelect,
}: {
  item: BrowsableModel;
  selected: boolean;
  onSelect: () => void;
}) {
  // Some "cover images" are videos or dead links
  const [coverFailed, setCoverFailed] = useState(false);
  const cover =
    item.coverImageUrl && !/\.(mp4|webm|mov)(\?|$)/i.test(item.coverImageUrl)
      ? item.coverImageUrl
      : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        "flex h-full w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors",
        selected
          ? "border-accent bg-accent-soft ring-1 ring-accent"
          : "border-line bg-sunken hover:border-line-strong"
      )}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised text-fg-subtle">
        {cover && !coverFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            onError={() => setCoverFailed(true)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon name="sparkles" size={18} />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold text-fg">{item.name}</span>
          {item.approved ? (
            <Badge tone="success">Approved</Badge>
          ) : (
            <Badge tone="warning">Unpriced</Badge>
          )}
        </span>

        <span className="truncate text-xs text-fg-subtle">
          {item.owner}
          {item.runCount ? ` · ${compact.format(item.runCount)} runs` : ""}
        </span>

        {item.description && (
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">
            {item.description}
          </span>
        )}
      </span>
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { canDeleteAllMedia, canViewAllMedia } from "@/lib/auth/roles";
import { fetchAllElements, useElements, type Element } from "@/lib/client/elements";
import { errorMessage } from "@/lib/client/http";
import { elementSummary } from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, EmptyState, inputClass, PageHeader } from "@/app/components/ui/primitives";
import { GridSizeToggle, PAGE_GRID, useGridSize, type GridSize } from "@/app/components/ui/GridSize";
import ElementCover from "./ElementCover";
import ElementDialog from "./ElementDialog";
import ElementGallery from "./ElementGallery";
import ElementViewDialog from "./ElementViewDialog";

// --------------------------------------------------
// ELEMENTS PAGE
//
// The user's saved characters, products and objects.
// Typing @ in a prompt lists them.
//
// The super admin can switch to everyone's elements,
// each marked with who made it, and filter by user.
// Their own open to edit; others' open read only, with
// a Delete button.
// A card's photo (or a reference in its corner) opens
// the photos full size.
// --------------------------------------------------

// Medium keeps this page's own 2 / 3 / 4 columns
const gridClass = (size: GridSize) =>
  cx("grid", size === "s" ? "gap-3" : "gap-4", size === "m" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : PAGE_GRID[size]);

export default function ElementsView() {
  const { currentUser } = useStudio();
  const [gridSize, setGridSize] = useGridSize("elements");
  const seesAll = canViewAllMedia(currentUser);
  const mine = useElements();
  // undefined: closed; null: new
  const [editing, setEditing] = useState<Element | null | undefined>(undefined);
  // Another user's element, open read only
  const [viewing, setViewing] = useState<Element | null>(null);
  // Photos open full size, from the one clicked
  const [gallery, setGallery] = useState<{ element: Element; start: number } | null>(null);
  const [query, setQuery] = useState("");

  // Everyone's elements (the super admin), and whose
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [everyone, setEveryone] = useState<{ elements: Element[] | null; error: string }>({ elements: null, error: "" });
  const [owner, setOwner] = useState("");

  // Loaded when switched to, and again after the user's
  // own elements change (an edit made from this page)
  useEffect(() => {
    if (scope !== "all") return;
    let cancelled = false;

    fetchAllElements()
      .then((list) => !cancelled && setEveryone({ elements: list, error: "" }))
      .catch((err) => !cancelled && setEveryone({ elements: [], error: errorMessage(err, "Couldn't load everyone's elements.") }));

    return () => {
      cancelled = true;
    };
  }, [scope, mine.elements]);

  const { elements, error } = scope === "all" ? everyone : mine;

  // The users who made elements, for the filter
  const owners = [
    ...new Map((everyone.elements ?? []).flatMap((item) => (item.addedBy ? [[item.addedBy.id, item.addedBy.name]] : []))),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const needle = query.trim().toLowerCase();
  const shown = (elements ?? []).filter(
    (element) =>
      (scope !== "all" || !owner || element.addedBy?.id === owner) &&
      (element.name.toLowerCase().includes(needle) ||
        element.description.toLowerCase().includes(needle) ||
        Boolean(element.addedBy?.name.toLowerCase().includes(needle)))
  );

  const isMine = (element: Element) => !element.addedBy || element.addedBy.id === currentUser.id;

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

      {seesAll && (
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Whose elements" className="flex gap-1.5">
            {(
              [
                ["mine", "My elements"],
                ["all", "Everyone's"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => {
                  setScope(value);
                  setOwner("");
                }}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  scope === value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {scope === "all" && owners.length > 0 && (
            <select
              aria-label="Added by"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className={cx(inputClass, "h-8 max-w-56 py-0 text-xs")}
            >
              <option value="">Everyone</option>
              {owners.map(([id, name]) => (
                <option key={id} value={id}>
                  {id === currentUser.id ? `${name} (you)` : name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {elements && elements.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${elements.length} element${elements.length === 1 ? "" : "s"}${scope === "all" ? " or who added them" : ""}`}
              aria-label="Search elements"
              className={cx(inputClass, "pl-9")}
            />
          </div>
          <GridSizeToggle size={gridSize} onChange={setGridSize} />
        </div>
      )}

      {elements === null ? (
        <ul aria-label="Loading elements" className={gridClass(gridSize)}>
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
      ) : elements.length === 0 && scope === "all" ? (
        <p className="py-12 text-center text-sm text-fg-muted">No one has made an element yet.</p>
      ) : elements.length === 0 ? (
        <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
          <EmptyState
            icon="at"
            title="No elements yet"
            description="Save a character, product or object with reference images, and optionally videos of it moving and its voice. Then type @ in a prompt and pick it: its files go in with the run."
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
        <ul className={gridClass(gridSize)}>
          {shown.map((element, index) => (
            <li key={element.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
              <ElementCard
                element={element}
                owner={element.addedBy ? (isMine(element) ? "You" : element.addedBy.name) : null}
                editable={isMine(element)}
                onOpen={() => (isMine(element) ? setEditing(element) : setViewing(element))}
                onPreview={(start) => setGallery({ element, start })}
              />
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined && <ElementDialog element={editing} onClose={() => setEditing(undefined)} />}
      {viewing && (
        <ElementViewDialog
          element={viewing}
          canDelete={canDeleteAllMedia(currentUser)}
          // Off the list at once (it reloads too)
          onDeleted={() =>
            setEveryone((now) => ({ ...now, elements: now.elements?.filter((item) => item.id !== viewing.id) ?? null }))
          }
          onClose={() => setViewing(null)}
        />
      )}
      {gallery && <ElementGallery element={gallery.element} start={gallery.start} onClose={() => setGallery(null)} />}
    </div>
  );
}

function ElementCard({
  element,
  owner,
  editable,
  onOpen,
  onPreview,
}: {
  element: Element;
  // Who made it, in everyone's elements
  owner: string | null;
  editable: boolean;
  onOpen: () => void;
  // Full-size view from the photo at this place
  onPreview: (index: number) => void;
}) {
  const rest = element.images.slice(1);
  const [cover] = element.images;
  // Photos or videos to look at (a voice-only element
  // has none, so its picture opens it instead)
  const viewable = element.images.length + element.videos.length > 0;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl">
      <div className="relative aspect-square overflow-hidden bg-black">
        <button
          type="button"
          onClick={() => (viewable ? onPreview(0) : onOpen())}
          aria-label={viewable ? `View @${element.name}'s photos` : `${editable ? "Edit" : "View"} @${element.name}`}
          className="absolute inset-0 block cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          {cover ? (
            <>
              {/* The whole photo, on a blurred copy of itself */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt=""
                loading="lazy"
                className="relative h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
              />
            </>
          ) : (
            <ElementCover
              element={element}
              iconSize={36}
              className="h-full w-full transition-transform duration-500 group-hover:scale-105"
            />
          )}
          <span className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        </button>

        {/* The other photos, fanned in the corner: each
            opens the viewer on itself */}
        {rest.length > 0 && (
          <span className="absolute bottom-2.5 right-2.5 flex">
            {rest.slice(0, 3).map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() => onPreview(index + 1)}
                aria-label={`View image ${index + 2}`}
                className="-ml-3 h-10 w-10 overflow-hidden rounded-lg border-2 border-surface bg-black shadow-md transition-transform duration-200 first:ml-0 hover:z-10 hover:-translate-y-1 hover:scale-110 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-accent"
                style={{ transitionDelay: `${index * 30}ms` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
            {rest.length > 3 && (
              <button
                type="button"
                onClick={() => onPreview(4)}
                aria-label={`View ${rest.length - 3} more images`}
                className="-ml-3 flex h-10 w-10 items-center justify-center rounded-lg border-2 border-surface bg-black/80 text-xs font-medium text-white transition-transform duration-200 hover:z-10 hover:-translate-y-1 hover:scale-110"
              >
                +{rest.length - 3}
              </button>
            )}
          </span>
        )}

        {/* Videos and voice clips it carries */}
        {(element.videos.length > 0 || element.audios.length > 0) && (
          <span className="pointer-events-none absolute right-2.5 top-2.5 flex gap-1">
            {(["video", "audio"] as const).map((kind) => {
              const count = (kind === "video" ? element.videos : element.audios).length;
              return count ? (
                <span
                  key={kind}
                  title={kind === "video" ? `${count} reference video${count === 1 ? "" : "s"}` : `${count} voice clip${count === 1 ? "" : "s"}`}
                  className="flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur"
                >
                  <Icon name={kind} size={11} />
                  {count}
                </span>
              ) : null;
            })}
          </span>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-all duration-300 hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-90"
        >
          <Icon name={editable ? "settings" : "eye"} size={11} />
          {editable ? "Edit" : "View"}
        </button>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="block w-full p-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <span className="block truncate text-sm font-semibold text-fg">
          <span className="text-accent">@</span>
          {element.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
          {element.description || elementSummary(element)}
        </span>
        {owner && (
          <span className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-fg-subtle" title={`Added by ${owner}`}>
            <Icon name="users" size={10} className="shrink-0" />
            Added by <span className="font-medium text-fg-muted">{owner}</span>
          </span>
        )}
      </button>
    </div>
  );
}

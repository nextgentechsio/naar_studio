"use client";

import { useEffect, useState } from "react";
import { catalogueApi, type Library } from "@/lib/client/catalogue";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { ASSET_KINDS, ASSET_LABELS, type AssetKind, type PublicAsset, type PublicTemplate } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Badge, Button, cx, EmptyState, PageHeader } from "@/app/components/ui/primitives";
import AssetDialog from "./AssetDialog";
import { AssetBadges, AssetCover, ASSET_ICONS, ASSET_SINGULAR } from "./parts";
import TemplateDialog, { copyOf, SHOT_TYPE_LABELS } from "./TemplateDialog";

// --------------------------------------------------
// CATALOGUE LIBRARY PAGE
//
// The models, poses, backgrounds, accessories and
// templates products are shot with. Everyone browses
// the active ones; admins add, edit, archive and delete
// (and can show archived items).
// --------------------------------------------------

type Section = AssetKind | "template";

const SECTIONS: { id: Section; label: string }[] = [
  ...ASSET_KINDS.map((kind) => ({ id: kind, label: ASSET_LABELS[kind] })),
  { id: "template", label: "Templates" },
];

const INTRO: Record<Section, string> = {
  model: "The people products are shot on. A face photo keeps the same person across every shot.",
  pose: "Stance, mood and camera, written as a brief. Poses are sent as text, not as images.",
  background: "Studio backdrops and lifestyle scenes.",
  accessory: "Extras a product can be styled with (up to a few per product).",
  template: "The recipe of shots each product gets: the initial look first, then the rest.",
};

// What's open: a new one (id null) or an existing one,
// with the item as it was when opened (still shown while
// the window closes after a delete)
type Open = { section: Section; id: string | null; item?: PublicAsset | PublicTemplate } | null;

export default function LibraryView() {
  const [section, setSection] = useState<Section>("model");
  const [showArchived, setShowArchived] = useState(false);
  const [state, setState] = useState<{ library: Library | null; error: string }>({ library: null, error: "" });
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState("");

  // Again with archived items when an editor asks
  useEffect(() => {
    let cancelled = false;
    catalogueApi
      .library(showArchived)
      .then((library) => !cancelled && setState({ library, error: "" }))
      .catch((err) => {
        logRequestError(err);
        if (!cancelled) setState((now) => ({ ...now, error: errorMessage(err, "Couldn't load the library.") }));
      });
    return () => {
      cancelled = true;
    };
  }, [showArchived]);

  const { library, error } = state;
  const canEdit = Boolean(library?.canEdit);

  const visible = <T extends { status: "active" | "archived" }>(items: T[]) =>
    showArchived ? items : items.filter((item) => item.status === "active");

  const assets = library?.assets ?? [];
  const templates = library?.templates ?? [];
  const countOf = (id: Section) =>
    id === "template" ? visible(templates).length : visible(assets.filter((asset) => asset.kind === id)).length;

  // ---------- Local updates after a save ----------

  const patch = (change: (library: Library) => Library) =>
    setState((now) => (now.library ? { ...now, library: change(now.library) } : now));

  const putAsset = (asset: PublicAsset) =>
    patch((lib) => ({
      ...lib,
      assets: lib.assets.some((item) => item.id === asset.id)
        ? lib.assets.map((item) => (item.id === asset.id ? asset : item))
        : [...lib.assets, asset].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const dropAsset = (id: string) => patch((lib) => ({ ...lib, assets: lib.assets.filter((item) => item.id !== id) }));

  const putTemplate = (template: PublicTemplate) =>
    patch((lib) => ({
      ...lib,
      templates: lib.templates.some((item) => item.id === template.id)
        ? lib.templates.map((item) => (item.id === template.id ? template : item))
        : [...lib.templates, template].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const dropTemplate = (id: string) =>
    patch((lib) => ({ ...lib, templates: lib.templates.filter((item) => item.id !== id) }));

  // Saves a copy and opens it to edit
  async function duplicate(template: PublicTemplate) {
    const { template: copy } = await catalogueApi.createTemplate(copyOf(template));
    putTemplate(copy);
    setOpen({ section: "template", id: copy.id, item: copy });
  }

  async function duplicateFromCard(template: PublicTemplate) {
    setNotice("");
    try {
      await duplicate(template);
    } catch (err) {
      logRequestError(err);
      setNotice(errorMessage(err, "Couldn't duplicate the template."));
    }
  }

  const openAsset =
    open && open.section !== "template" && open.id
      ? assets.find((item) => item.id === open.id) ?? (open.item as PublicAsset)
      : null;
  const openTemplate =
    open?.section === "template" && open.id
      ? templates.find((item) => item.id === open.id) ?? (open.item as PublicTemplate)
      : null;

  const sectionLabel = section === "template" ? "template" : ASSET_SINGULAR[section];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Library"
        description="Models, poses, backgrounds, accessories and shot templates for your catalogue."
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived((value) => !value)}
                className={cx(
                  "flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                  showArchived ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                <Icon name={showArchived ? "eye" : "eyeOff"} size={15} />
                Show archived
              </button>
              <Button variant="primary" icon="sparkles" onClick={() => setOpen({ section, id: null })}>
                Add {sectionLabel}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Sections */}
      <div role="group" aria-label="Library sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
            className={cx(
              "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              section === item.id
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
            )}
          >
            <Icon name={item.id === "template" ? "folder" : ASSET_ICONS[item.id]} size={14} />
            {item.label}
            {library && <span className="text-xs tabular-nums opacity-70">{countOf(item.id)}</span>}
          </button>
        ))}
      </div>

      <p className="-mt-2 text-sm text-fg-muted">{INTRO[section]}</p>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert>{notice}</Alert>}

      {!library ? (
        error ? null : <Skeleton templates={section === "template"} />
      ) : section === "template" ? (
        <TemplateGrid
          templates={visible(templates)}
          assets={assets}
          canEdit={canEdit}
          onOpen={(template) => setOpen({ section: "template", id: template.id, item: template })}
          onAdd={() => setOpen({ section: "template", id: null })}
          onDuplicate={duplicateFromCard}
        />
      ) : (
        <AssetGrid
          kind={section}
          assets={visible(assets.filter((asset) => asset.kind === section))}
          canEdit={canEdit}
          onOpen={(asset) => setOpen({ section, id: asset.id, item: asset })}
          onAdd={() => setOpen({ section, id: null })}
        />
      )}

      {open && open.section !== "template" && (
        <AssetDialog
          key={open.id ?? "new"}
          kind={open.section}
          asset={openAsset}
          canEdit={canEdit}
          onSaved={putAsset}
          onDeleted={dropAsset}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.section === "template" && (
        <TemplateDialog
          key={open.id ?? "new"}
          template={openTemplate}
          assets={assets}
          canEdit={canEdit}
          onSaved={putTemplate}
          onDeleted={dropTemplate}
          onDuplicate={duplicate}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// ---------- Assets ----------

function AssetGrid({
  kind,
  assets,
  canEdit,
  onOpen,
  onAdd,
}: {
  kind: AssetKind;
  assets: PublicAsset[];
  canEdit: boolean;
  onOpen: (asset: PublicAsset) => void;
  onAdd: () => void;
}) {
  if (!assets.length) {
    return (
      <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
        <EmptyState
          icon={ASSET_ICONS[kind]}
          title={`No ${ASSET_LABELS[kind].toLowerCase()} yet`}
          description={canEdit ? `Add the first ${ASSET_SINGULAR[kind]} for products to use.` : "An admin can add some."}
          action={
            canEdit ? (
              <Button variant="primary" icon="sparkles" onClick={onAdd}>
                Add {ASSET_SINGULAR[kind]}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset, index) => (
        <li key={asset.id} className="ui-rise min-w-0" style={{ "--i": index } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => onOpen(asset)}
            aria-label={`${canEdit ? "Edit" : "View"} ${asset.name}`}
            className={cx(
              "group block w-full overflow-hidden rounded-2xl border border-line bg-surface text-left transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              asset.status === "archived" && "opacity-70"
            )}
          >
            <span className="relative block">
              <AssetCover
                asset={asset}
                iconSize={16}
                className="aspect-3/4 w-full transition-transform duration-500 group-hover:scale-[1.03]"
              />
              <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                <Icon name={canEdit ? "edit" : "eye"} size={11} />
                {canEdit ? "Edit" : "View"}
              </span>
            </span>
            <span className="block p-3">
              <span className="block truncate text-sm font-semibold text-fg">{asset.name}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                <AssetBadges asset={asset} />
              </span>
              {(asset.prompt || asset.notes) && (
                <span className="mt-1.5 line-clamp-2 text-xs leading-5 text-fg-subtle">{asset.prompt || asset.notes}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------- Templates ----------

function TemplateGrid({
  templates,
  assets,
  canEdit,
  onOpen,
  onAdd,
  onDuplicate,
}: {
  templates: PublicTemplate[];
  assets: PublicAsset[];
  canEdit: boolean;
  onOpen: (template: PublicTemplate) => void;
  onAdd: () => void;
  onDuplicate: (template: PublicTemplate) => Promise<void>;
}) {
  const [copying, setCopying] = useState<string | null>(null);

  if (!templates.length) {
    return (
      <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
        <EmptyState
          icon="folder"
          title="No templates yet"
          description={canEdit ? "A template lists the shots each product gets." : "An admin can add some."}
          action={
            canEdit ? (
              <Button variant="primary" icon="sparkles" onClick={onAdd}>
                New template
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const nameOf = (id: string | null) => (id ? assets.find((asset) => asset.id === id)?.name : undefined);

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((template, index) => (
        <li
          key={template.id}
          className={cx(
            "ui-rise group flex min-w-0 flex-col rounded-2xl border border-line bg-surface transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-xl",
            template.status === "archived" && "opacity-70"
          )}
          style={{ "--i": index } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => onOpen(template)}
            className="block min-w-0 flex-1 rounded-t-2xl p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-base font-semibold text-fg">{template.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                {template.shots.length} shot{template.shots.length === 1 ? "" : "s"}
              </span>
            </span>
            {(template.builtIn || template.status === "archived" || template.categories.length > 0) && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                {template.builtIn && <Badge tone="accent">Built-in</Badge>}
                {template.status === "archived" && <Badge tone="warning">Archived</Badge>}
                {template.categories.slice(0, 3).map((category) => (
                  <Badge key={category}>{category}</Badge>
                ))}
                {template.categories.length > 3 && <Badge>+{template.categories.length - 3}</Badge>}
              </span>
            )}
            {template.description && (
              <span className="mt-2 line-clamp-2 text-sm leading-5 text-fg-muted">{template.description}</span>
            )}
            <span className="mt-3 flex flex-wrap gap-1.5">
              {template.shots.map((shot) => {
                const pose = nameOf(shot.poseId);
                return (
                  <span
                    key={shot.id}
                    title={`${SHOT_TYPE_LABELS[shot.type]}${pose ? ` · ${pose}` : ""}`}
                    className={cx(
                      "max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      shot.type === "initial" ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-sunken text-fg-muted"
                    )}
                  >
                    {shot.label}
                  </span>
                );
              })}
            </span>
          </button>

          <span className="flex items-center justify-end gap-1 border-t border-line px-2 py-1.5">
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                disabled={copying === template.id}
                onClick={async () => {
                  setCopying(template.id);
                  await onDuplicate(template);
                  setCopying(null);
                }}
              >
                {copying === template.id ? "Copying…" : "Duplicate"}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={canEdit ? "edit" : "eye"} onClick={() => onOpen(template)}>
              {canEdit ? "Edit" : "View"}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Skeleton({ templates }: { templates: boolean }) {
  return templates ? (
    <ul aria-label="Loading templates" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="space-y-3 rounded-2xl border border-line p-4">
          <div className="ui-skeleton h-4 w-1/2 rounded" />
          <div className="ui-skeleton h-3 w-3/4 rounded" />
          <div className="flex gap-1.5">
            {Array.from({ length: 4 }, (_, chip) => (
              <div key={chip} className="ui-skeleton h-5 w-14 rounded-md" />
            ))}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <ul aria-label="Loading library" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-2xl border border-line">
          <div className="ui-skeleton aspect-3/4" />
          <div className="space-y-2 p-3">
            <div className="ui-skeleton h-3.5 w-1/2 rounded" />
            <div className="ui-skeleton h-3 w-3/4 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

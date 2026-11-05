"use client";

import { useState } from "react";
import type { ProductShot, PublicAsset, PublicProduct } from "@/lib/catalogue/shared";
import { Modal } from "@/app/components/ui/Modal";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { Badge, Button, cx, Spinner } from "@/app/components/ui/primitives";
import { assetsOf } from "../_parts/product-ui";

// --------------------------------------------------
// APPROVE: PLAN THE OTHER SHOTS
//
// Before the rest of the template is shot from the
// approved look, each shot can get its own pose and
// background (else the template's, else the product's),
// and shots can be left out. Sent as the approve call's
// shotIds / poseOverrides / backgroundOverrides.
// --------------------------------------------------

type Kind = "pose" | "background";
type Choices = Record<string, string | null>;

export type ShotPlan = {
  shotIds: string[];
  poseOverrides: Record<string, string>;
  backgroundOverrides: Record<string, string>;
};

const TYPE_LABELS: Record<string, string> = {
  front: "Front",
  back: "Back",
  side: "Side",
  closeup: "Close-up",
  detail: "Detail",
  lifestyle: "Lifestyle",
  full: "Full length",
};

export default function ShotPlanDialog({
  product,
  assets,
  initialUrl,
  onApprove,
  onClose,
}: {
  product: PublicProduct;
  // null while the library loads
  assets: PublicAsset[] | null;
  initialUrl: string | null;
  onApprove: (plan: ShotPlan) => Promise<void>;
  onClose: () => void;
}) {
  const shots = product.shots.slice(1);
  const [included, setIncluded] = useState(() => new Set(shots.map((shot) => shot.shotId)));
  const [poses, setPoses] = useState<Choices>(() => Object.fromEntries(shots.map((shot) => [shot.shotId, shot.poseId])));
  const [backgrounds, setBackgrounds] = useState<Choices>(() =>
    Object.fromEntries(shots.map((shot) => [shot.shotId, shot.backgroundId])),
  );
  const [open, setOpen] = useState<{ shotId: string; kind: Kind } | null>(null);
  const [busy, setBusy] = useState(false);

  const keep = [...Object.values(poses), ...Object.values(backgrounds)];
  const poseList = assets ? assetsOf(assets, "pose", product.gender, keep) : [];
  const backgroundList = assets ? assetsOf(assets, "background", product.gender, keep) : [];
  const byId = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  const count = included.size;

  function toggle(shotId: string) {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }

  function choose(kind: Kind, shotId: string, id: string | null, all = false) {
    const set = kind === "pose" ? setPoses : setBackgrounds;
    set((current) => (all ? Object.fromEntries(Object.keys(current).map((key) => [key, id])) : { ...current, [shotId]: id }));
  }

  // What a shot gets with no choice of its own
  function fallback(shot: ProductShot, kind: Kind): { label: string; asset: PublicAsset | null } {
    const templateId = kind === "pose" ? shot.templatePoseId : shot.templateBackgroundId;
    const productId = kind === "pose" ? product.poseId : product.backgroundId;
    const template = templateId ? byId.get(templateId) : undefined;
    if (template) return { label: `Template: ${template.name}`, asset: template };
    const own = productId ? byId.get(productId) : undefined;
    if (own) return { label: `Product: ${own.name}`, asset: own };
    return kind === "pose"
      ? { label: "AI picks for the angle", asset: null }
      : { label: "Same as the initial look", asset: null };
  }

  async function submit(close: () => void) {
    const pick = (choices: Choices) =>
      Object.fromEntries(
        Object.entries(choices).filter((entry): entry is [string, string] => included.has(entry[0]) && Boolean(entry[1])),
      );
    setBusy(true);
    // Closed either way: the workspace shows why it failed
    await onApprove({
      shotIds: shots.filter((shot) => included.has(shot.shotId)).map((shot) => shot.shotId),
      poseOverrides: pick(poses),
      backgroundOverrides: pick(backgrounds),
    });
    close();
  }

  return (
    <Modal
      title="Plan the shots"
      subtitle="Choose a pose and background for each shot. They all keep the approved model, garment and styling."
      size="xl"
      onClose={onClose}
    >
      {(close) => (
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-3 overflow-y-auto px-5 pb-4 pt-1">
            <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken/60 p-2.5">
              {initialUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={initialUrl} alt="Approved initial look" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-surface text-fg-subtle">
                  <Icon name="shirt" size={18} />
                </span>
              )}
              <p className="text-xs text-fg-muted">
                <span className="font-semibold text-fg">Initial look, approved.</span> Every shot below is taken from it.
                Leave a choice on its default to use the template&apos;s.
              </p>
            </div>

            <ol className="space-y-2">
              {shots.map((shot, index) => {
                const on = included.has(shot.shotId);
                return (
                  <li
                    key={shot.shotId}
                    className={cx(
                      "rounded-xl border p-3 transition-all duration-300",
                      on ? "border-line bg-surface/70" : "border-dashed border-line bg-transparent opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(shot.shotId)}
                          disabled={busy}
                          className="h-4 w-4 shrink-0 accent-(--accent)"
                        />
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-fg-muted">
                          {index + 2}
                        </span>
                        <span className="truncate text-sm font-semibold text-fg">{shot.label}</span>
                        {TYPE_LABELS[shot.type] && <Badge className="shrink-0">{TYPE_LABELS[shot.type]}</Badge>}
                      </label>
                    </div>

                    {on && (
                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        {(["pose", "background"] as const).map((kind) => {
                          const chosenId = (kind === "pose" ? poses : backgrounds)[shot.shotId];
                          const chosen = chosenId ? byId.get(chosenId) : undefined;
                          const shown = chosen ? { label: chosen.name, asset: chosen } : fallback(shot, kind);
                          const expanded = open?.shotId === shot.shotId && open.kind === kind;
                          return (
                            <Chooser
                              key={kind}
                              kind={kind}
                              label={shown.label}
                              asset={shown.asset}
                              custom={Boolean(chosen)}
                              expanded={expanded}
                              disabled={busy}
                              onClick={() => setOpen(expanded ? null : { shotId: shot.shotId, kind })}
                            />
                          );
                        })}
                      </div>
                    )}

                    {on && open?.shotId === shot.shotId && (
                      <Options
                        key={open.kind}
                        kind={open.kind}
                        assets={open.kind === "pose" ? poseList : backgroundList}
                        loading={assets === null}
                        selected={(open.kind === "pose" ? poses : backgrounds)[shot.shotId]}
                        defaultLabel={fallback(shot, open.kind).label}
                        canApplyAll={shots.length > 1}
                        onPick={(id) => {
                          choose(open.kind, shot.shotId, id);
                          setOpen(null);
                        }}
                        onApplyAll={() => {
                          choose(open.kind, shot.shotId, (open.kind === "pose" ? poses : backgrounds)[shot.shotId], true);
                          setOpen(null);
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="text-xs text-fg-subtle">
              Images go to {product.project.name}. You can regenerate or change any pose later.
            </p>
            <div className="flex gap-2">
              <Button onClick={close} disabled={busy}>
                Not yet
              </Button>
              <Button
                variant="primary"
                icon={busy ? undefined : "check"}
                disabled={busy || count === 0}
                onClick={() => void submit(close)}
              >
                {busy && <Spinner />}
                {busy ? "Starting shots…" : `Approve & shoot ${count} shot${count === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Thumb({ asset, icon, className }: { asset: PublicAsset | null; icon: IconName; className?: string }) {
  if (asset?.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset.imageUrl} alt="" loading="lazy" className={cx("object-cover", className)} />;
  }
  return (
    <span className={cx("flex items-center justify-center bg-sunken text-fg-subtle", className)}>
      <Icon name={asset ? icon : "sparkles"} size={14} />
    </span>
  );
}

function Chooser({
  kind,
  label,
  asset,
  custom,
  expanded,
  disabled,
  onClick,
}: {
  kind: Kind;
  label: string;
  asset: PublicAsset | null;
  custom: boolean;
  expanded: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex min-w-0 items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors duration-200",
        expanded ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-sunken/60",
      )}
    >
      <Thumb asset={asset} icon={kind === "pose" ? "users" : "image"} className="h-9 w-9 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {kind === "pose" ? "Pose" : "Background"}
        </span>
        <span className={cx("block truncate text-xs", custom ? "font-semibold text-fg" : "text-fg-muted")}>{label}</span>
      </span>
      <Icon
        name="chevronDown"
        size={14}
        className={cx("shrink-0 text-fg-subtle transition-transform duration-200", expanded && "rotate-180")}
      />
    </button>
  );
}

function Options({
  kind,
  assets,
  loading,
  selected,
  defaultLabel,
  canApplyAll,
  onPick,
  onApplyAll,
}: {
  kind: Kind;
  assets: PublicAsset[];
  loading: boolean;
  selected: string | null;
  defaultLabel: string;
  canApplyAll: boolean;
  onPick: (id: string | null) => void;
  onApplyAll: () => void;
}) {
  const icon: IconName = kind === "pose" ? "users" : "image";
  const tile =
    "group relative w-20 shrink-0 snap-start overflow-hidden rounded-lg border text-left transition-all duration-200";

  return (
    <div className="ui-rise mt-2.5 rounded-lg border border-line bg-sunken/50 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">
          {loading ? `Loading ${kind}s…` : `Choose a ${kind}`}
        </span>
        {canApplyAll && (
          <button type="button" onClick={onApplyAll} className="text-xs font-medium text-accent hover:underline">
            Use this choice for every shot
          </button>
        )}
      </div>
      <ul className="flex snap-x gap-2 overflow-x-auto pb-1" role="listbox" aria-label={`${kind} for this shot`}>
        <li>
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => onPick(null)}
            title={defaultLabel}
            className={cx(tile, !selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong")}
          >
            <span className="flex aspect-3/4 items-center justify-center bg-accent-soft text-accent">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="block truncate px-1.5 py-1 text-[10px] font-medium text-fg">Default</span>
          </button>
        </li>
        {assets.map((asset) => {
          const on = selected === asset.id;
          return (
            <li key={asset.id}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onPick(asset.id)}
                title={asset.prompt || asset.name}
                className={cx(tile, on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong")}
              >
                <Thumb asset={asset} icon={icon} className="block aspect-3/4 w-full" />
                <span className="block truncate px-1.5 py-1 text-[10px] font-medium text-fg">{asset.name}</span>
                {on && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-on-accent">
                    <Icon name="check" size={10} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {!loading && assets.length === 0 && (
          <li className="self-center px-2 text-xs text-fg-subtle">No {kind}s in the library yet.</li>
        )}
      </ul>
    </div>
  );
}

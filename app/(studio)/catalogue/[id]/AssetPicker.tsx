"use client";

import type { PublicAsset } from "@/lib/catalogue/shared";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// PICK LIBRARY ASSETS (models, poses, backgrounds,
// accessories) as small cards
//
// `none` adds a first card for "no choice" (Let AI
// choose / product default), selected when nothing is.
// --------------------------------------------------

export default function AssetPicker({
  label,
  assets,
  selected,
  onToggle,
  none,
  icon,
  shape = "portrait",
  disabled,
}: {
  label: string;
  assets: PublicAsset[];
  selected: string[];
  // null: the "none" card
  onToggle: (id: string | null) => void;
  none?: { label: string; hint: string };
  icon: IconName;
  shape?: "portrait" | "landscape";
  disabled?: boolean;
}) {
  const aspect = shape === "portrait" ? "aspect-3/4" : "aspect-4/3";
  const cols =
    shape === "portrait"
      ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7"
      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

  return (
    <ul role="group" aria-label={label} className={cx("grid gap-2.5", cols)}>
      {none && (
        <li>
          <Tile
            pressed={selected.length === 0}
            onClick={() => onToggle(null)}
            disabled={disabled}
            aspect={aspect}
            name={none.label}
            hint={none.hint}
          >
            <span className="absolute inset-0 flex items-center justify-center bg-accent-soft text-accent">
              <Icon name="sparkles" size={26} />
            </span>
          </Tile>
        </li>
      )}
      {assets.map((asset) => (
        <li key={asset.id}>
          <Tile
            pressed={selected.includes(asset.id)}
            onClick={() => onToggle(asset.id)}
            disabled={disabled}
            aspect={aspect}
            name={asset.name}
            hint={asset.prompt}
          >
            {asset.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={asset.imageUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-sunken p-2 text-fg-subtle">
                <Icon name={icon} size={22} />
              </span>
            )}
          </Tile>
        </li>
      ))}
    </ul>
  );
}

function Tile({
  pressed,
  onClick,
  disabled,
  aspect,
  name,
  hint,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  aspect: string;
  name: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      title={hint || name}
      className={cx(
        "group relative block w-full overflow-hidden rounded-xl border transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50",
        aspect,
        pressed ? "border-accent ring-2 ring-accent/40" : "border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg",
      )}
    >
      {children}
      <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/65 via-transparent to-transparent" />
      <span className="absolute inset-x-1.5 bottom-1.5 truncate text-left text-[11px] font-medium text-white">{name}</span>
      {pressed && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent shadow">
          <Icon name="check" size={12} />
        </span>
      )}
    </button>
  );
}

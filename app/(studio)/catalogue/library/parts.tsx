"use client";

import type { CSSProperties, ReactNode } from "react";
import type { AssetKind, PublicAsset } from "@/lib/catalogue/shared";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { Badge, cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// CATALOGUE LIBRARY: small shared pieces (cover,
// badges, toggle chips)
// --------------------------------------------------

export const ASSET_SINGULAR: Record<AssetKind, string> = {
  model: "model",
  pose: "pose",
  background: "background",
  accessory: "accessory",
};

export const ASSET_ICONS: Record<AssetKind, IconName> = {
  model: "users",
  pose: "sparkles",
  background: "image",
  accessory: "shirt",
};

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "Soft studio grey" → "SS"
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

// A steady hue per name, so a preset keeps its colour
function hue(name: string) {
  let sum = 0;
  for (const char of name) sum = (sum * 31 + char.charCodeAt(0)) % 360;
  return sum;
}

// The item's photo, or a soft gradient with its
// initials for text-only presets
export function AssetCover({
  asset,
  className,
  iconSize = 14,
}: {
  asset: Pick<PublicAsset, "name" | "kind" | "imageUrl">;
  className?: string;
  iconSize?: number;
}) {
  if (asset.imageUrl) {
    return (
      <span className={cx("block overflow-hidden bg-sunken", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }

  const h = hue(asset.name);
  const style = {
    backgroundImage: `radial-gradient(120% 80% at 20% 0%, hsl(${h} 70% 60% / 0.38), transparent 60%), linear-gradient(160deg, hsl(${(h + 40) % 360} 55% 50% / 0.22), hsl(${(h + 200) % 360} 45% 45% / 0.12))`,
  } as CSSProperties;

  return (
    <span className={cx("relative flex items-center justify-center overflow-hidden bg-sunken [container-type:size]", className)} style={style}>
      <span className="text-[clamp(0.7rem,22cqmin,2.5rem)] font-semibold tracking-tight text-fg/70">
        {initials(asset.name)}
      </span>
      <span className="absolute bottom-2 right-2 text-fg-subtle">
        <Icon name={ASSET_ICONS[asset.kind]} size={iconSize} />
      </span>
    </span>
  );
}

export function AssetBadges({ asset }: { asset: PublicAsset }) {
  return (
    <>
      {(asset.kind === "model" || asset.kind === "pose") && (
        <Badge>{asset.gender ? capital(asset.gender) : "Any gender"}</Badge>
      )}
      {asset.kind === "background" && asset.setting && <Badge>{capital(asset.setting)}</Badge>}
      {asset.builtIn && <Badge tone="accent">Built-in</Badge>}
      {asset.status === "archived" && <Badge tone="warning">Archived</Badge>}
    </>
  );
}

// Pill buttons: one choice (options) or several
export function ChipGroup<T extends string>({
  label,
  options,
  isOn,
  onToggle,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  isOn: (value: T) => boolean;
  onToggle: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={isOn(option.value)}
          disabled={disabled}
          onClick={() => onToggle(option.value)}
          className={cx(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            isOn(option.value)
              ? "border-accent bg-accent-soft text-accent"
              : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}


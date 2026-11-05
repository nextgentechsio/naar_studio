"use client";

import type {
  AssetKind,
  Gender,
  ImageModelId,
  ProductShot,
  ProductStatus,
  PublicAsset,
  Resolution,
  ShotRun,
} from "@/lib/catalogue/shared";
import { Badge, Spinner } from "@/app/components/ui/primitives";

// --------------------------------------------------
// CATALOGUE PRODUCTS: small shared pieces
//
// Status labels, the per-image price hint, a shot's
// current state and a relative "updated" time.
// --------------------------------------------------

const STATUS: Record<ProductStatus, { label: string; tone: "neutral" | "accent" | "warning" | "success" }> = {
  draft: { label: "Draft", tone: "neutral" },
  initial: { label: "Initial look", tone: "accent" },
  shooting: { label: "Shooting", tone: "warning" },
  done: { label: "Done", tone: "success" },
};

export function StatusBadge({ status, className }: { status: ProductStatus; className?: string }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge tone={tone} className={className}>
      {status === "shooting" && <Spinner className="h-2.5 w-2.5 border-[1.5px]" />}
      {label}
    </Badge>
  );
}

// Rough per-image prices (USD) for the hint; the real
// charge is recorded in Expenses when a run finishes
// (direct ones: typical token use at the list prices in
// lib/catalogue/direct.ts, with a few reference photos)
const PRICES: Record<ImageModelId, Record<Resolution, number>> = {
  "google:gemini-nano-banana-2.1": { "1K": 0.05, "2K": 0.067 },
  "openai:gpt-image-2.5-sunburst": { "1K": 0.046, "2K": 0.065 },
  "google/nano-banana-2": { "1K": 0.067, "2K": 0.101 },
  "openai/gpt-image-2.5-sunburst": { "1K": 0.047, "2K": 0.128 },
};

export function imagePrice(model: ImageModelId, resolution: Resolution): number {
  return PRICES[model]?.[resolution] ?? 0;
}

// What a shot shows right now
export function shotState(shot: ProductShot) {
  const selected = shot.runs.find((run) => run.generationId === shot.selected && run.imageUrl) ?? null;
  const latest = shot.runs[0] ?? null;
  return {
    selected,
    latest,
    pending: latest?.status === "pending",
    failed: latest?.status === "failed" ? latest : null,
    imageUrl: selected?.imageUrl ?? null,
  };
}

export function hasPending(shots: ProductShot[]) {
  return shots.some((shot) => shot.runs.some((run: ShotRun) => run.status === "pending"));
}

// Active library items of a kind that suit the gender,
// plus any already chosen (even if archived since)
export function assetsOf(assets: PublicAsset[] | undefined, kind: AssetKind, gender: Gender, keep: (string | null)[] = []) {
  return (assets ?? []).filter(
    (asset) =>
      asset.kind === kind &&
      (keep.includes(asset.id) || (asset.status === "active" && (!asset.gender || asset.gender === gender))),
  );
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

// "5 minutes ago", "yesterday", "3 weeks ago"
export function timeAgo(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

// Segmented choice (pill buttons)
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-full border border-line bg-sunken p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={
            value === option.value
              ? "rounded-full bg-accent px-3 py-1 text-xs font-medium text-on-accent transition-colors"
              : "rounded-full px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

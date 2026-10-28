"use client";

import { Icon } from "@/app/components/ui/Icon";
import { cx, inputClass } from "@/app/components/ui/primitives";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  higgsfieldPriceHint,
  higgsfieldPriceKind,
  type HiggsfieldModel,
} from "@/lib/higgsfield/models";

// --------------------------------------------------
// MODEL PICKER (Generate page: Higgsfield, ElevenLabs)
//
// Every model Higgsfield lists, grouped by what it does,
// with "Browse all models" for search. Same layout as the
// Replicate picker beside the project.
// --------------------------------------------------

// "Kling 3.0 Standard · Text to video"
export function higgsfieldModelName(item: HiggsfieldModel) {
  return item.task && !item.title.toLowerCase().includes(item.task.toLowerCase())
    ? `${item.title} · ${item.task}`
    : item.title;
}

export default function HiggsfieldModelPicker({
  model,
  models,
  loading,
  onChoose,
  onBrowse,
  priceHint = higgsfieldPriceHint,
}: {
  model: string;
  models: HiggsfieldModel[];
  loading: boolean;
  onChoose: (id: string) => void;
  // "Browse all models" (left out for short lists)
  onBrowse?: () => void;
  // The model's price line (ElevenLabs passes its own)
  priceHint?: (id: string) => string | null;
}) {
  const current = models.find((item) => item.id === model);
  const unpriced = Boolean(model) && higgsfieldPriceKind(model) === "unreported";
  const price = model ? (priceHint(model) ?? "priced per run") : null;

  return (
    <div className="min-w-0">
      <label htmlFor="generate-model" className="mb-1.5 block text-xs font-medium text-fg-muted">
        Model{" "}
        <span className="text-danger" aria-hidden>
          *
        </span>
      </label>

      <div className="flex items-center gap-2">
        <span
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            model
              ? "border-accent bg-accent text-on-accent"
              : "border-line bg-sunken text-fg-subtle"
          )}
          aria-hidden
        >
          <Icon name={current?.output ?? "video"} size={16} />
        </span>

        <select
          id="generate-model"
          required
          value={model}
          disabled={loading && !models.length}
          onChange={(event) => onChoose(event.target.value)}
          className={cx(inputClass, "min-w-0", !model && "text-fg-subtle")}
        >
          <option value="" disabled>
            {loading && !models.length ? "Loading models…" : "Select model"}
          </option>
          {CATEGORY_ORDER.map((category) => {
            const items = models.filter((item) => item.category === category);
            if (!items.length) return null;

            return (
              <optgroup key={category} label={CATEGORY_LABELS[category]}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {higgsfieldModelName(item)}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {/* e.g. a "Run again" of a model Higgsfield dropped */}
          {model && !current && !loading && (
            <option value={model}>{model}</option>
          )}
        </select>
      </div>

      {/* Under the select: what it is, and the way to search */}
      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-3 pl-11 text-xs">
        <p
          className={cx("min-w-0 truncate", unpriced ? "text-warning" : "text-fg-subtle")}
          title={
            unpriced
              ? "Higgsfield bills this model by internal AI usage it doesn't report, so its runs are recorded as unpriced in Expenses."
              : current?.description
          }
        >
          {!model
            ? models.length
              ? `${models.length} models`
              : ""
            : unpriced
              ? "Unpriced: usage not reported"
              : `${current?.task || CATEGORY_LABELS[current?.category ?? "other"]} · ${price}`}
        </p>
        {onBrowse && (
          <button
            type="button"
            onClick={onBrowse}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline"
          >
            <Icon name="search" size={12} />
            Browse all models
          </button>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------
// VARIANTS: the same model's other versions
//
// Higgsfield lists each way of using a model separately
// (Seedance 2.5 text-to-video, image-to-video, video
// edit, …), and only some take images, videos or audio.
// One click switches between them.
// --------------------------------------------------

export function HiggsfieldVariants({
  model,
  models,
  onChoose,
  className,
}: {
  model: string;
  models: HiggsfieldModel[];
  onChoose: (id: string) => void;
  className?: string;
}) {
  const current = models.find((item) => item.id === model);
  if (!current) return null;

  const seen = new Set<string>();
  const variants = models
    .filter((item) => item.title === current.title)
    .map((item) => ({ id: item.id, label: item.task || CATEGORY_LABELS[item.category] }))
    // Two variants with the same name: keep the first
    .filter((item) => !seen.has(item.label) && seen.add(item.label));

  if (variants.length < 2) return null;

  return (
    <div className={cx("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <span className="mr-0.5 text-xs text-fg-subtle">{current.title}:</span>
      <div role="group" aria-label={`${current.title} variants`} className="contents">
        {variants.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === model}
            onClick={() => onChoose(item.id)}
            className={cx(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              item.id === model
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

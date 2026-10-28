"use client";

import { useRef, useState } from "react";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Icon } from "@/app/components/ui/Icon";
import { Button, cx, EmptyState, inputClass } from "@/app/components/ui/primitives";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  higgsfieldPriceHint,
  higgsfieldPriceKind,
  type HiggsfieldCategory,
  type HiggsfieldModel,
} from "@/lib/higgsfield/models";
import { higgsfieldModelName } from "./HiggsfieldModelPicker";

// --------------------------------------------------
// BROWSE ALL HIGGSFIELD MODELS (window)
//
// Search by name, maker or description, narrow by what
// the model does, pick one. Closes once a model is
// picked.
// --------------------------------------------------

export default function HiggsfieldModelBrowser({
  models,
  current,
  onPick,
  onClose,
}: {
  models: HiggsfieldModel[];
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, onClose);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<HiggsfieldCategory | "all">("all");

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = models.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    const text = `${item.title} ${item.id} ${item.task} ${item.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  const counts = new Map<HiggsfieldCategory, number>();
  for (const item of models) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);

  const chip = (active: boolean) =>
    cx(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-accent bg-accent-soft text-accent"
        : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browse-higgsfield-title"
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="ui-backdrop absolute inset-0 bg-black/40 backdrop-blur-[3px]"
        onClick={onClose}
      />

      <div
        ref={panel}
        className="relative flex max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col rounded-xl border glass"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id="browse-higgsfield-title" className="text-sm font-semibold text-fg">
            All Higgsfield models
          </h2>
          <Button size="sm" variant="ghost" icon="close" aria-label="Close" onClick={onClose} />
        </div>

        <div className="space-y-3 border-b border-line px-5 py-3.5">
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="search"
              data-autofocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models, e.g. Kling, Seedance, upscale"
              aria-label="Search models"
              className={cx(inputClass, "pl-9")}
            />
          </div>

          <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
              className={chip(category === "all")}
            >
              All · {models.length}
            </button>
            {CATEGORY_ORDER.filter((value) => counts.get(value)).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={chip(category === value)}
              >
                {CATEGORY_LABELS[value]} · {counts.get(value)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!shown.length ? (
            <EmptyState
              compact
              icon="search"
              title="No models match"
              description="Try another name or type."
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {shown.map((item) => {
                const unpriced = higgsfieldPriceKind(item.id) === "unreported";
                const price = higgsfieldPriceHint(item.id) ?? "Priced per run";

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(item.id);
                        onClose();
                      }}
                      className={cx(
                        "flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        item.id === current
                          ? "border-accent bg-accent-soft"
                          : "border-line hover:border-line-strong hover:bg-sunken"
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised text-fg-muted">
                        <Icon name={item.output} size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-fg">
                          {higgsfieldModelName(item)}
                        </span>
                        <span className="block truncate text-xs text-fg-subtle">{item.id}</span>
                        <span className="mt-1 block text-xs text-fg-muted">
                          {CATEGORY_LABELS[item.category]}
                          {item.workflow ? " · Workflow" : ""}
                          {" · "}
                          <span className={unpriced ? "text-warning" : ""}>
                            {unpriced ? "Unpriced" : price}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

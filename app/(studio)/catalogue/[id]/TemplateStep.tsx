"use client";

import { Icon } from "@/app/components/ui/Icon";
import { Alert, Badge, Button, cx, EmptyState } from "@/app/components/ui/primitives";
import type { StepProps } from "./types";

// --------------------------------------------------
// STEP 2: TEMPLATE (the shots to take)
//
// Fixed once the initial look is approved.
// --------------------------------------------------

export default function TemplateStep({ product, library, update, goTo }: StepProps) {
  const locked = product.status === "shooting" || product.status === "done";
  const templates = (library?.templates ?? []).filter(
    (template) => template.status === "active" || template.id === product.templateId,
  );

  return (
    <div className="space-y-4">
      {locked && (
        <Alert tone="warning">The initial look is approved, so the template can&apos;t change any more.</Alert>
      )}

      {library === null ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="ui-skeleton h-40 rounded-2xl" />
          ))}
        </ul>
      ) : templates.length === 0 ? (
        <div className="glass rounded-2xl border">
          <EmptyState
            icon="gridMedium"
            title="No templates yet"
            description="An admin adds templates (the set of shots to take) in the Library tab."
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template, index) => {
            const selected = template.id === product.templateId;
            const fits = !template.categories.length || template.categories.includes(product.category);
            return (
              <li key={template.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={locked && !selected}
                  onClick={() => !selected && void update({ templateId: template.id })}
                  className={cx(
                    "glass relative flex h-full w-full flex-col rounded-2xl border p-4 text-left transition-all duration-300",
                    selected
                      ? "border-accent! ring-2 ring-accent/30"
                      : "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-fg">{template.name}</span>
                    {selected ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
                        <Icon name="check" size={12} />
                      </span>
                    ) : (
                      fits &&
                      template.categories.length > 0 && <Badge tone="accent">For {product.category}</Badge>
                    )}
                  </span>
                  {template.description && (
                    <span className="mt-1 line-clamp-3 text-xs leading-5 text-fg-muted">{template.description}</span>
                  )}
                  <span className="mt-3 flex flex-wrap gap-1">
                    {template.shots.map((shot, shotIndex) => (
                      <span
                        key={shot.id}
                        className={cx(
                          "rounded-full border px-2 py-0.5 text-[11px]",
                          shotIndex === 0 ? "border-accent/30 bg-accent-soft text-accent" : "border-line bg-sunken text-fg-muted",
                        )}
                      >
                        {shot.label}
                      </span>
                    ))}
                  </span>
                  <span className="mt-auto pt-3 text-[11px] text-fg-subtle">
                    {template.shots.length} shot{template.shots.length === 1 ? "" : "s"}
                    {template.categories.length > 0 && ` · ${template.categories.join(", ")}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button icon="chevronLeft" onClick={() => goTo(1)}>
          Details
        </Button>
        <Button variant="primary" icon="chevronRight" disabled={!product.templateId} onClick={() => goTo(3)}>
          Continue to model
        </Button>
      </div>
    </div>
  );
}

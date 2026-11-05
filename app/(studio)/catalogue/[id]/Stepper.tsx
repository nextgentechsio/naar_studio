"use client";

import type { PublicProduct } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// PRODUCT STEPS (across the top of the workspace)
//
// Any step can be opened; a tick marks the ones done.
// --------------------------------------------------

export const STEPS = [
  { label: "Details & photos", short: "Details" },
  { label: "Template", short: "Template" },
  { label: "Model & styling", short: "Model" },
  { label: "Initial look", short: "Look" },
  { label: "Shots", short: "Shots" },
] as const;

export type Step = 1 | 2 | 3 | 4 | 5;

export function stepDone(product: PublicProduct, step: Step): boolean {
  const approved = product.status === "shooting" || product.status === "done";
  switch (step) {
    case 1:
      return Boolean(product.name && product.inputs.front);
    case 2:
      return Boolean(product.templateId);
    case 3:
      return product.status !== "draft";
    case 4:
      return approved;
    case 5:
      return product.status === "done";
  }
}

// Where a product opens
export function defaultStep(product: PublicProduct): Step {
  if (product.status === "shooting" || product.status === "done") return 5;
  if (product.status === "initial") return 4;
  if (!product.inputs.front) return 1;
  if (!product.templateId) return 2;
  return 3;
}

export default function Stepper({
  product,
  step,
  onStep,
}: {
  product: PublicProduct;
  step: Step;
  onStep: (step: Step) => void;
}) {
  return (
    <nav aria-label="Steps" className="glass rounded-2xl border p-1.5">
      <ol className="grid grid-cols-5 gap-1">
        {STEPS.map((item, index) => {
          const number = (index + 1) as Step;
          const current = number === step;
          const done = stepDone(product, number);
          return (
            <li key={item.label} className="min-w-0">
              <button
                type="button"
                onClick={() => onStep(number)}
                aria-current={current ? "step" : undefined}
                className={cx(
                  "flex w-full min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:text-left",
                  current ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-fg/[0.05] hover:text-fg",
                )}
              >
                <span
                  className={cx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                    current
                      ? "border-accent bg-accent text-on-accent"
                      : done
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-line-strong",
                  )}
                >
                  {done && !current ? <Icon name="check" size={12} /> : number}
                </span>
                <span className="w-full truncate text-[11px] font-medium sm:text-sm">
                  <span className="lg:hidden">{item.short}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

"use client";

import type { ReactNode } from "react";
import { IMAGE_MODELS, MAX_ACCESSORIES, RESOLUTIONS } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { Button, cx, formatCost } from "@/app/components/ui/primitives";
import { assetsOf, imagePrice, Segmented } from "../_parts/product-ui";
import AssetPicker from "./AssetPicker";
import type { StepProps } from "./types";

// --------------------------------------------------
// STEP 3: MODEL & STYLING
//
// Who wears it, an optional pose / background / up to 3
// accessories, and the image model and size. Each choice
// is saved as it's made.
// --------------------------------------------------

export default function StylingStep({ product, library, update, goTo }: StepProps) {
  const assets = library?.assets;
  const models = assetsOf(assets, "model", product.gender, [product.modelId]);
  const poses = assetsOf(assets, "pose", product.gender, [product.poseId]);
  const backgrounds = assetsOf(assets, "background", product.gender, [product.backgroundId]);
  const accessories = assetsOf(assets, "accessory", product.gender, product.accessoryIds);
  const loading = library === null;

  const pick = (key: "modelId" | "poseId" | "backgroundId") => (id: string | null) => {
    const next = id === product[key] ? null : id;
    if (next !== product[key]) void update({ [key]: next });
  };

  function toggleAccessory(id: string | null) {
    if (!id) return void update({ accessoryIds: [] });
    const current = product.accessoryIds;
    if (current.includes(id)) return void update({ accessoryIds: current.filter((item) => item !== id) });
    if (current.length >= MAX_ACCESSORIES) return;
    void update({ accessoryIds: [...current, id] });
  }

  return (
    <div className="space-y-4">
      <Section title="Model" description={`Who wears it. Showing ${product.gender} and unisex personas.`}>
        {loading ? (
          <Skeletons />
        ) : (
          <AssetPicker
            label="Model"
            icon="users"
            assets={models}
            selected={product.modelId ? [product.modelId] : []}
            onToggle={pick("modelId")}
            none={{ label: "Let AI choose", hint: "A model is cast to suit the garment" }}
          />
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Pose" description="Optional. Each shot in the template can also set its own.">
          {loading ? (
            <Skeletons />
          ) : (
            <AssetPicker
              label="Pose"
              icon="users"
              shape="landscape"
              assets={poses}
              selected={product.poseId ? [product.poseId] : []}
              onToggle={pick("poseId")}
              none={{ label: "Template default", hint: "Use each shot's own pose" }}
            />
          )}
        </Section>

        <Section title="Background" description="Optional. Studio or lifestyle scene.">
          {loading ? (
            <Skeletons />
          ) : (
            <AssetPicker
              label="Background"
              icon="image"
              shape="landscape"
              assets={backgrounds}
              selected={product.backgroundId ? [product.backgroundId] : []}
              onToggle={pick("backgroundId")}
              none={{ label: "Template default", hint: "Use each shot's own background" }}
            />
          )}
        </Section>
      </div>

      <Section
        title="Accessories"
        description={`Up to ${MAX_ACCESSORIES}. ${product.accessoryIds.length} chosen.`}
      >
        {loading ? (
          <Skeletons />
        ) : accessories.length === 0 ? (
          <p className="text-sm text-fg-subtle">No accessories in the library yet.</p>
        ) : (
          <AssetPicker
            label="Accessories"
            icon="sparkles"
            assets={accessories}
            selected={product.accessoryIds}
            onToggle={toggleAccessory}
            none={{ label: "None", hint: "No accessories" }}
          />
        )}
      </Section>

      <Section title="Image model" description="Used for the initial look and every shot.">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {IMAGE_MODELS.map((model) => {
            const selected = product.imageModel === model.id;
            return (
              <button
                key={model.id}
                type="button"
                aria-pressed={selected}
                onClick={() => !selected && void update({ imageModel: model.id })}
                className={cx(
                  "relative rounded-xl border p-3.5 text-left transition-all duration-300",
                  selected ? "border-accent bg-accent-soft ring-2 ring-accent/30" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-fg">{model.label}</span>
                    <span className="shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-medium text-fg-subtle">
                      {model.via}
                    </span>
                  </span>
                  {selected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
                      <Icon name="check" size={12} />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-fg-muted">{model.hint}</span>
                <span className="mt-2 block text-[11px] text-fg-subtle">
                  {RESOLUTIONS.map((size) => `${size} ≈ ${formatCost(imagePrice(model.id, size))}`).join(" · ")} per image
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-fg">Size</span>
          <Segmented
            label="Size"
            value={product.resolution}
            options={RESOLUTIONS.map((size) => ({ value: size, label: size }))}
            onChange={(resolution) => resolution !== product.resolution && void update({ resolution })}
          />
          <span className="text-xs text-fg-subtle">
            ≈ {formatCost(imagePrice(product.imageModel, product.resolution))} per image
          </span>
        </div>
      </Section>

      <div className="flex flex-wrap justify-between gap-2">
        <Button icon="chevronLeft" onClick={() => goTo(2)}>
          Template
        </Button>
        <Button variant="primary" icon="chevronRight" onClick={() => goTo(4)}>
          Continue to initial look
        </Button>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="glass rounded-2xl border p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {description && <p className="mb-3.5 mt-0.5 text-xs text-fg-muted">{description}</p>}
      {children}
    </section>
  );
}

function Skeletons() {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="ui-skeleton aspect-3/4 rounded-xl" />
      ))}
    </div>
  );
}

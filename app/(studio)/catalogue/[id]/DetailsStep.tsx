"use client";

import { useState, type FormEvent } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { CATEGORIES, GENDERS, INPUT_SLOTS, NAME_MAX, type Gender } from "@/lib/catalogue/shared";
import { Button, Field, inputClass, textareaClass } from "@/app/components/ui/primitives";
import PhotoSlot from "./PhotoSlot";
import type { StepProps } from "./types";

// --------------------------------------------------
// STEP 1: DETAILS & PHOTOS
// --------------------------------------------------

export default function DetailsStep({ product, update, goTo }: StepProps) {
  const { projects } = useStudio();
  // Edited here until saved (polling doesn't reset it)
  const [form, setForm] = useState(() => ({
    name: product.name,
    sku: product.sku,
    category: product.category,
    gender: product.gender,
    notes: product.notes,
    project: product.project.name,
  }));
  const set = (key: keyof typeof form) => (value: string) => setForm((now) => ({ ...now, [key]: value }));

  const saved = {
    name: product.name,
    sku: product.sku,
    category: product.category,
    gender: product.gender,
    notes: product.notes,
    project: product.project.name,
  };
  const changed = (Object.keys(form) as (keyof typeof form)[]).filter((key) => form[key] !== saved[key]);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!changed.length) return;
    await update(Object.fromEntries(changed.map((key) => [key, form[key]])));
  }

  // The product's category even if it's not in the list
  const categories = CATEGORIES.includes(form.category as (typeof CATEGORIES)[number])
    ? CATEGORIES
    : [form.category, ...CATEGORIES];
  const projectNames = projects.some((item) => item.name === form.project)
    ? projects.map((item) => item.name)
    : [form.project, ...projects.map((item) => item.name)];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form onSubmit={save} className="glass space-y-4 rounded-2xl border p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-fg">Details</h2>

        <Field label="Name" required>
          {(props) => (
            <input
              {...props}
              value={form.name}
              maxLength={NAME_MAX}
              onChange={(event) => set("name")(event.target.value)}
              className={inputClass}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU">
            {(props) => (
              <input
                {...props}
                value={form.sku}
                maxLength={80}
                onChange={(event) => set("sku")(event.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Category">
            {(props) => (
              <select {...props} value={form.category} onChange={(event) => set("category")(event.target.value)} className={inputClass}>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Model gender">
            {(props) => (
              <select
                {...props}
                value={form.gender}
                onChange={(event) => set("gender")(event.target.value as Gender)}
                className={inputClass}
              >
                {GENDERS.map((item) => (
                  <option key={item} value={item}>
                    {item === "female" ? "Female" : "Male"}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Project"
            hint={product.projectLocked ? "Locked: its images are already billed to this project" : "Billed for every image"}
          >
            {(props) => (
              <select {...props} disabled={product.projectLocked} value={form.project} onChange={(event) => set("project")(event.target.value)} className={inputClass}>
                {projectNames.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field label="Notes" hint="Fabric, fit, anything the shoot should know">
          {(props) => (
            <textarea
              {...props}
              rows={4}
              value={form.notes}
              onChange={(event) => set("notes")(event.target.value)}
              className={textareaClass}
            />
          )}
        </Field>

        <div className="flex items-center justify-end gap-3">
          {changed.length > 0 && <span className="text-xs text-fg-subtle">Unsaved changes</span>}
          <Button type="submit" variant="primary" disabled={!changed.length || !form.name.trim()}>
            Save details
          </Button>
        </div>
      </form>

      <section className="glass rounded-2xl border p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-fg">Garment photos</h2>
            <p className="mt-0.5 text-xs text-fg-muted">The front is required; every other view helps the model get it right.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {INPUT_SLOTS.map((slot) => (
            <PhotoSlot
              key={slot.key}
              product={product}
              slot={slot}
              onSave={(url) => update({ inputs: { [slot.key]: url } })}
            />
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            variant="primary"
            icon="chevronRight"
            disabled={!product.inputs.front}
            onClick={() => {
              void save();
              goTo(2);
            }}
          >
            Continue to template
          </Button>
        </div>
      </section>
    </div>
  );
}

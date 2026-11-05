"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { CATEGORIES, GENDERS, NAME_MAX, type Gender } from "@/lib/catalogue/shared";
import { catalogueApi } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, Button, Field, inputClass, textareaClass } from "@/app/components/ui/primitives";

// --------------------------------------------------
// NEW CATALOGUE PRODUCT (window)
//
// The basics and the project it's billed to; photos,
// template and styling come next, in the product's
// own workspace.
// --------------------------------------------------

export default function NewProductDialog({
  onClose,
  defaultProject = "",
}: {
  onClose: () => void;
  // The project being viewed in Catalogue
  defaultProject?: string;
}) {
  const router = useRouter();
  const { projects, projectsError } = useStudio();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [gender, setGender] = useState<Gender>("female");
  const [notes, setNotes] = useState("");
  // Preselected when there's only one to choose
  const [project, setProject] = useState(defaultProject);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const chosenProject = project || (projects.length === 1 ? projects[0].name : "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Add a name");
    if (!chosenProject) return setError("Choose a project for it");
    setSaving(true);
    setError("");
    try {
      const { product } = await catalogueApi.createProduct({
        name: name.trim(),
        sku: sku.trim(),
        category,
        gender,
        notes: notes.trim(),
        project: chosenProject,
      });
      router.push(`/catalogue/${product.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the product."));
      setSaving(false);
    }
  }

  return (
    <Modal title="New product" subtitle="One garment or SKU. You'll add its photos next." onClose={onClose}>
      {(close) => (
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-4 pt-2">
            <Field label="Name" required>
              {(props) => (
                <input
                  {...props}
                  data-autofocus
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Linen wrap dress"
                  className={inputClass}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU">
                {(props) => (
                  <input
                    {...props}
                    value={sku}
                    maxLength={80}
                    onChange={(event) => setSku(event.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Category">
                {(props) => (
                  <select {...props} value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
                    {CATEGORIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Model gender">
                {(props) => (
                  <select
                    {...props}
                    value={gender}
                    onChange={(event) => setGender(event.target.value as Gender)}
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
              <Field label="Project" required error={projectsError || undefined} hint={projectsError ? undefined : "Its images are kept under this project"}>
                {(props) => (
                  <select
                    {...props}
                    value={chosenProject}
                    onChange={(event) => setProject(event.target.value)}
                    className={inputClass}
                  >
                    <option value="" disabled>
                      {projects.length ? "Choose a project" : "No active projects"}
                    </option>
                    {projects.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            <Field label="Notes" hint="Fabric, fit, anything the shoot should know">
              {(props) => (
                <textarea
                  {...props}
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Relaxed fit, mid-weight linen, falls below the knee"
                  className={textareaClass}
                />
              )}
            </Field>

            {error && <Alert>{error}</Alert>}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Creating…" : "Create product"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

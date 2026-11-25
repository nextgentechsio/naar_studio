"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProjectAvatar from "@/app/components/ProjectAvatar";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import { prepareProjectPhoto } from "@/lib/storage/prepare-image";
import type { PublicProject } from "@/lib/auth/roles";

// --------------------------------------------------
// PROJECT MANAGEMENT (admins and the super admin;
// permanent delete is super admin only)
//
// Every action is re-checked by /api/projects.
// Archived projects disappear from the Generate page
// but keep their history.
// --------------------------------------------------

type FormState = {
  mode: "create" | "edit";
  id?: string;
  name: string;
  description: string;
  // Saved photo (edit mode), a newly picked one, or a
  // request to remove the saved one
  currentImageUrl: string | null;
  photo: File | null;
  photoPreview: string | null;
  removePhoto: boolean;
};

const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
// Before client-side downscaling; the 5 MB limit is
// enforced on the prepared file and again by the server
const PHOTO_PICK_MAX_BYTES = 25 * 1024 * 1024;

const inputClass =
  "h-11 w-full rounded-xl border border-line bg-sunken px-3 text-sm outline-none focus:border-accent";

async function callApi(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

// Multipart upload: the browser sets the boundary, so
// no Content-Type header here
async function uploadPhoto(projectId: string, file: File) {
  const prepared = await prepareProjectPhoto(file);

  if (prepared.size > PHOTO_MAX_BYTES) {
    throw new Error("Photo must be 5 MB or smaller");
  }

  const body = new FormData();
  body.append("file", prepared, file.name);

  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/image`,
    { method: "PUT", body }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        `Photo upload failed (${response.status})`
    );
  }
}

export default function ProjectsAdmin({
  canDelete,
  onProjectsChanged,
}: {
  // Only the super admin sees the Delete button
  canDelete: boolean;
  // Lets the parent refresh the Generate dropdown
  onProjectsChanged?: () => void;
}) {
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // Free the preview's object URL when it's replaced or
  // the form closes
  const previewUrl = form?.photoPreview ?? null;

  useEffect(() => {
    if (!previewUrl) return;

    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // `loading` starts true; reloads refresh in place
  const loadProjects = useCallback(async () => {
    try {
      const data = await callApi("/api/projects?all=1");
      setProjects((data.projects as PublicProject[]) ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load projects"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (state is only set in the callbacks)
  useEffect(() => {
    let cancelled = false;

    callApi("/api/projects?all=1")
      .then((data) => {
        if (!cancelled) {
          setProjects(
            (data.projects as PublicProject[]) ?? []
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load projects"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function afterChange(message: string) {
    setNotice(message);
    await loadProjects();
    onProjectsChanged?.();
  }

  function openCreate() {
    setError("");
    setNotice("");
    setForm({
      mode: "create",
      name: "",
      description: "",
      currentImageUrl: null,
      photo: null,
      photoPreview: null,
      removePhoto: false,
    });
  }

  function openEdit(project: PublicProject) {
    setError("");
    setNotice("");
    setForm({
      mode: "edit",
      id: project.id,
      name: project.name,
      description: project.description,
      currentImageUrl: project.imageUrl,
      photo: null,
      photoPreview: null,
      removePhoto: false,
    });
  }

  function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Allow re-picking the same file after removing it
    event.target.value = "";

    if (file) acceptPhoto(file);
  }

  // From the picker or a drag & drop
  function acceptPhoto(file: File) {
    if (!form) return;

    if (!PHOTO_ACCEPT.split(",").includes(file.type)) {
      setError("Photo must be a PNG, JPEG, WebP or GIF image.");
      return;
    }

    if (file.size > PHOTO_PICK_MAX_BYTES) {
      setError("That photo is too large. Pick one under 25 MB.");
      return;
    }

    setError("");
    setForm({
      ...form,
      photo: file,
      photoPreview: URL.createObjectURL(file),
      removePhoto: false,
    });
  }

  const photoDrop = useFileDrop((files) => acceptPhoto(files[0]), {
    disabled: !form,
  });

  function clearPhoto() {
    if (!form) return;

    setForm({
      ...form,
      photo: null,
      photoPreview: null,
      // Only an already-saved photo needs a server call
      removePhoto: Boolean(form.currentImageUrl),
    });
  }

  async function submitForm(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!form) return;

    setError("");
    setNotice("");
    setSaving(true);

    let projectId = form.id;

    try {
      if (form.mode === "create") {
        const data = await callApi("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            description: form.description,
          }),
        });

        projectId = (data.project as PublicProject).id;
      } else {
        await callApi(`/api/projects/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            description: form.description,
          }),
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Save failed"
      );
      setSaving(false);
      return;
    }

    // The project is saved at this point. A photo failure
    // is reported, but the form switches to edit mode so a
    // retry can't create a duplicate project.
    try {
      if (projectId && form.photo) {
        await uploadPhoto(projectId, form.photo);
      } else if (projectId && form.removePhoto) {
        await callApi(
          `/api/projects/${encodeURIComponent(projectId)}/image`,
          { method: "DELETE" }
        );
      }

      const message =
        form.mode === "create"
          ? `Created ${form.name}.`
          : `Updated ${form.name}.`;

      setForm(null);
      await afterChange(message);
    } catch (err) {
      // Keep anything typed while saving
      setForm((current) =>
        current ? { ...current, mode: "edit", id: projectId } : current
      );
      await afterChange("");
      setError(
        `Saved ${form.name}, but the photo was not ${
          form.photo ? "uploaded" : "removed"
        }: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived(project: PublicProject) {
    setError("");
    setNotice("");

    const archiving = project.status === "active";

    try {
      await callApi(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: archiving ? "archived" : "active",
        }),
      });

      await afterChange(
        `${project.name} ${
          archiving ? "archived" : "restored"
        }.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Update failed"
      );
    }
  }

  async function removeProject(project: PublicProject) {
    if (
      !window.confirm(
        `Delete ${project.name}? This cannot be undone. Archive it instead to keep it out of the Replicate page.`
      )
    ) {
      return;
    }

    setError("");
    setNotice("");

    try {
      await callApi(`/api/projects/${project.id}`, {
        method: "DELETE",
      });

      await afterChange(`Deleted ${project.name}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Delete failed"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-fg-muted">
          Active projects appear in the Replicate page.
        </p>

        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          Add project
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      {form && (
        <form
          onSubmit={submitForm}
          className="space-y-5 rounded-2xl border border-line bg-surface p-5"
        >
          <h2 className="font-semibold">
            {form.mode === "create"
              ? "New project"
              : `Edit ${form.name}`}
          </h2>

          <div
            {...photoDrop.dropProps}
            className={`flex flex-wrap items-center gap-4 rounded-xl border border-dashed p-3 transition-colors ${
              photoDrop.dragging
                ? "border-accent bg-accent-soft"
                : "border-line-strong"
            }`}
          >
            <ProjectAvatar
              name={form.name}
              imageUrl={
                form.photoPreview ??
                (form.removePhoto ? null : form.currentImageUrl)
              }
              size={72}
            />

            <div className="space-y-2">
              <p className="text-sm text-fg">
                Photo (optional)
              </p>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={photoInput}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  onChange={pickPhoto}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-raised"
                >
                  {form.photoPreview ||
                  (form.currentImageUrl && !form.removePhoto)
                    ? "Change photo"
                    : "Upload photo"}
                </button>

                {(form.photoPreview ||
                  (form.currentImageUrl &&
                    !form.removePhoto)) && (
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/15"
                  >
                    Remove
                  </button>
                )}
              </div>

              <p className="text-xs text-fg-subtle">
                {photoDrop.dragging
                  ? "Drop the photo to use it."
                  : "Or drag & drop it here. PNG, JPEG, WebP or GIF; large photos are resized before upload."}
              </p>
            </div>
          </div>

          <label className="block space-y-2">
            <span className="block text-sm text-fg">
              Project name
            </span>

            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              required
              maxLength={60}
              autoComplete="off"
              placeholder="e.g. Landmark"
              className={inputClass}
            />
          </label>

          <label className="block space-y-2">
            <span className="block text-sm text-fg">
              Description (optional)
            </span>

            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({
                  ...form,
                  description: event.target.value,
                })
              }
              rows={3}
              maxLength={500}
              className="w-full resize-y rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:bg-raised disabled:text-fg-subtle"
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-xl border border-line-strong px-4 py-2 text-sm text-fg hover:bg-raised"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {loading ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            Loading projects...
          </div>
        ) : !projects.length ? (
          <div className="p-10 text-center text-sm text-fg-subtle">
            No projects yet. Add one to start generating.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {projects.map((project) => (
              <div
                key={project.id}
                className="grid items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_90px_220px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProjectAvatar
                    name={project.name}
                    imageUrl={project.imageUrl}
                  />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">
                      {project.name}
                    </p>

                    <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">
                      {project.description || "No description"}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-xs ${
                    project.status === "active"
                      ? "text-fg-muted"
                      : "font-medium text-warning"
                  }`}
                >
                  {project.status === "active"
                    ? "Active"
                    : "Archived"}
                </span>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(project)}
                    className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-raised"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleArchived(project)}
                    className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg hover:bg-raised"
                  >
                    {project.status === "active"
                      ? "Archive"
                      : "Restore"}
                  </button>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => removeProject(project)}
                      className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/15"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

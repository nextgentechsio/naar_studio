"use client";

import { useRef, useState } from "react";
import { catalogueApi, uploadLibraryImage } from "@/lib/client/catalogue";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { NAME_MAX, PROMPT_MAX, type AssetKind, type Gender, type PublicAsset } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, Badge, Button, cx, Field, inputClass, Spinner, textareaClass } from "@/app/components/ui/primitives";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import { AssetBadges, AssetCover, ASSET_SINGULAR, capital, ChipGroup } from "./parts";

// --------------------------------------------------
// CATALOGUE LIBRARY: add, edit or view one model, pose,
// background or accessory
//
// Editors (admins) get the form, a photo upload,
// archive and delete; everyone else a read-only view.
// --------------------------------------------------

const COPY: Record<
  AssetKind,
  { prompt: string; promptHint: string; placeholder: string; photo: string; photoHint: string }
> = {
  model: {
    prompt: "Who they are",
    promptHint: "Age, look, skin tone, hair, build. Optional when there's a face photo, but it helps.",
    placeholder:
      "e.g. Indian woman in her mid-20s, warm medium-brown skin, shoulder-length wavy black hair, slim athletic build, natural makeup",
    photo: "Face photo",
    photoHint: "A clear, front-facing face photo keeps the same person across every shot.",
  },
  pose: {
    prompt: "Pose brief",
    promptHint: "Sent as text (not an image): the stance, the mood and the camera.",
    placeholder:
      "POSE: weight on the back leg, one hand lightly in the pocket, shoulders relaxed\nMOOD: confident, easy half-smile\nCAMERA: eye level, full body, 50mm, centred",
    photo: "Example photo",
    photoHint: "Optional: shows what the pose looks like here in the library.",
  },
  background: {
    prompt: "The scene",
    promptHint: "Where the shot happens: backdrop, light and atmosphere.",
    placeholder:
      "e.g. Seamless warm-grey studio backdrop, soft diffused key light from the left, gentle floor shadow",
    photo: "Reference photo",
    photoHint: "Optional: a photo of the backdrop or location.",
  },
  accessory: {
    prompt: "What it is and how it's worn",
    promptHint: "Describe the item and where it goes on the model.",
    placeholder: "e.g. Thin gold hoop earrings, small, worn in both ears",
    photo: "Product photo",
    photoHint: "A clean photo of the accessory on its own.",
  },
};

const GENDER_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
] as const;

const SETTING_OPTIONS = [
  { value: "studio", label: "Studio" },
  { value: "lifestyle", label: "Lifestyle" },
] as const;

export default function AssetDialog({
  kind,
  asset,
  canEdit,
  onSaved,
  onDeleted,
  onClose,
}: {
  kind: AssetKind;
  // null: a new one
  asset: PublicAsset | null;
  canEdit: boolean;
  onSaved: (asset: PublicAsset) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  if (!canEdit && asset) return <AssetView asset={asset} onClose={onClose} />;
  return <AssetForm kind={kind} asset={asset} onSaved={onSaved} onDeleted={onDeleted} onClose={onClose} />;
}

function AssetForm({
  kind,
  asset,
  onSaved,
  onDeleted,
  onClose,
}: {
  kind: AssetKind;
  asset: PublicAsset | null;
  onSaved: (asset: PublicAsset) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const copy = COPY[kind];
  const singular = ASSET_SINGULAR[kind];

  const [name, setName] = useState(asset?.name ?? "");
  const [prompt, setPrompt] = useState(asset?.prompt ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [gender, setGender] = useState<Gender | null>(asset?.gender ?? null);
  const [setting, setSetting] = useState<"studio" | "lifestyle">(asset?.setting ?? "studio");
  const [imageUrl, setImageUrl] = useState<string | null>(asset?.imageUrl ?? null);
  // A photo on its way up: local preview and 0–100
  const [uploading, setUploading] = useState<{ preview: string; progress: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const promptRequired = kind === "pose" || kind === "background";
  const ready = Boolean(name.trim()) && (!promptRequired || Boolean(prompt.trim())) && !uploading && !busy;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError("");
    const preview = URL.createObjectURL(file);
    setUploading({ preview, progress: null });
    try {
      const url = await uploadLibraryImage(file, (progress) => setUploading({ preview, progress }));
      setImageUrl(url);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, `Couldn't upload ${file.name}.`));
    } finally {
      setUploading(null);
      URL.revokeObjectURL(preview);
    }
  }

  const { dragging, dropProps } = useFileDrop((files) => void upload(files[0]), { disabled: Boolean(uploading) });

  async function save(close: () => void) {
    setBusy(true);
    setError("");
    const body: Partial<PublicAsset> = {
      name: name.trim(),
      prompt,
      imageUrl,
      ...(kind === "model" ? { notes } : {}),
      ...(kind === "model" || kind === "pose" ? { gender } : {}),
      ...(kind === "background" ? { setting } : {}),
    };
    try {
      const { asset: saved } = asset
        ? await catalogueApi.updateAsset(asset.id, body)
        : await catalogueApi.createAsset({ ...body, kind });
      onSaved(saved);
      close();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, `Couldn't save the ${singular}.`));
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!asset) return;
    setBusy(true);
    setError("");
    try {
      const { asset: saved } = await catalogueApi.updateAsset(asset.id, {
        status: asset.status === "archived" ? "active" : "archived",
      });
      onSaved(saved);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't change it."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(close: () => void) {
    if (!asset) return;
    if (!window.confirm(`Delete "${asset.name}"? Products that used it simply leave it out.`)) return;
    setBusy(true);
    setError("");
    try {
      await catalogueApi.deleteAsset(asset.id);
      onDeleted(asset.id);
      close();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, `Couldn't delete the ${singular}.`));
      setBusy(false);
    }
  }

  const shown = uploading?.preview ?? imageUrl;

  return (
    <Modal
      size="lg"
      title={asset ? `Edit ${asset.name}` : `New ${singular}`}
      subtitle={asset ? <span className="flex flex-wrap gap-1.5"><AssetBadges asset={asset} /></span> : undefined}
      onClose={onClose}
    >
      {(close) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void save(close);
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-line p-5">
            {error && (
              <div className="ui-rise mb-4">
                <Alert>{error}</Alert>
              </div>
            )}

            <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
              {/* Photo */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg">
                  {copy.photo} <span className="font-normal text-fg-subtle">· optional</span>
                </p>
                <div
                  {...dropProps}
                  className={cx(
                    "group relative aspect-3/4 w-full max-w-40 overflow-hidden rounded-xl border-2 border-dashed transition-all",
                    dragging ? "border-accent bg-accent-soft ring-4 ring-accent/15" : shown ? "border-transparent" : "border-line-strong bg-sunken"
                  )}
                >
                  {shown ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shown}
                        alt={`${copy.photo} of ${name || singular}`}
                        className={cx("h-full w-full rounded-lg object-cover", uploading && "opacity-50 blur-[1px]")}
                      />
                      {uploading ? (
                        <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/25">
                          <span
                            className={cx("block h-full rounded-full bg-white transition-[width] duration-300", uploading.progress === null && "w-1/3 animate-pulse")}
                            style={uploading.progress === null ? undefined : { width: `${uploading.progress}%` }}
                          />
                          <span className="sr-only">Uploading</span>
                        </span>
                      ) : (
                        <span className="absolute inset-x-1.5 bottom-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                          <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            className="flex-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white backdrop-blur hover:bg-black"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => setImageUrl(null)}
                            className="flex items-center justify-center rounded-md bg-black/70 px-2 text-white backdrop-blur hover:bg-danger"
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        </span>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-xs text-fg-muted transition-colors hover:text-fg"
                    >
                      <Icon name="upload" size={18} />
                      {dragging ? "Drop to upload" : "Upload or drop a photo"}
                    </button>
                  )}
                </div>
                <p className="text-xs leading-5 text-fg-subtle">{copy.photoHint}</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>

              {/* Details */}
              <div className="min-w-0 space-y-4">
                <Field label="Name" required>
                  {(control) => (
                    <input
                      {...control}
                      value={name}
                      maxLength={NAME_MAX}
                      autoComplete="off"
                      onChange={(event) => setName(event.target.value)}
                      placeholder={kind === "model" ? "e.g. Aanya" : kind === "pose" ? "e.g. Relaxed hand in pocket" : kind === "background" ? "e.g. Warm grey studio" : "e.g. Gold hoops"}
                      className={inputClass}
                    />
                  )}
                </Field>

                <Field label={copy.prompt} required={promptRequired} hint={copy.promptHint}>
                  {(control) => (
                    <textarea
                      {...control}
                      rows={kind === "pose" ? 5 : 4}
                      value={prompt}
                      maxLength={PROMPT_MAX}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={copy.placeholder}
                      className={cx(textareaClass, "resize-y")}
                    />
                  )}
                </Field>

                {kind === "model" && (
                  <Field label="Wear style" hint="How they wear clothes: fit, tucks, sleeves, attitude.">
                    {(control) => (
                      <textarea
                        {...control}
                        rows={2}
                        value={notes}
                        maxLength={PROMPT_MAX}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="e.g. Wears clothes slightly relaxed; shirts half-tucked, sleeves pushed up"
                        className={cx(textareaClass, "resize-y")}
                      />
                    )}
                  </Field>
                )}

                {(kind === "model" || kind === "pose") && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-fg">Gender</p>
                    <ChipGroup
                      label="Gender"
                      options={GENDER_OPTIONS}
                      isOn={(value) => (value === "any" ? gender === null : gender === value)}
                      onToggle={(value) => setGender(value === "any" ? null : value)}
                    />
                  </div>
                )}

                {kind === "background" && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-fg">Setting</p>
                    <ChipGroup label="Setting" options={SETTING_OPTIONS} isOn={(value) => setting === value} onToggle={setSetting} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <div className="flex gap-1">
              {asset && (
                <>
                  <Button variant="ghost" size="sm" icon="trash" className="text-danger hover:text-danger" disabled={busy} onClick={() => void remove(close)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" icon={asset.status === "archived" ? "undo" : "folder"} disabled={busy} onClick={() => void toggleArchive()}>
                    {asset.status === "archived" ? "Unarchive" : "Archive"}
                  </Button>
                </>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!ready}>
                {busy && <Spinner />}
                {uploading ? "Uploading…" : asset ? "Save changes" : `Add ${singular}`}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Read only, for people who can't edit the library
function AssetView({ asset, onClose }: { asset: PublicAsset; onClose: () => void }) {
  const copy = COPY[asset.kind];

  return (
    <Modal size="lg" title={asset.name} subtitle={capital(ASSET_SINGULAR[asset.kind])} onClose={onClose}>
      {(close) => (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-line p-5">
            <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <AssetCover asset={asset} iconSize={18} className="aspect-3/4 w-full max-w-40 rounded-xl border border-line" />
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  <AssetBadges asset={asset} />
                </div>
                <ReadBlock label={copy.prompt} text={asset.prompt} />
                {asset.kind === "model" && <ReadBlock label="Wear style" text={asset.notes} />}
                {!asset.prompt && !(asset.kind === "model" && asset.notes) && (
                  <Badge>No description</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ReadBlock({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">{label}</p>
      <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-fg">{text}</p>
    </div>
  );
}

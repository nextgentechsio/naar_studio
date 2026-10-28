"use client";

import { useEffect, useRef, useState } from "react";
import MediaLibraryDialog from "@/app/(studio)/_generate/MediaLibraryDialog";
import { removeElement, saveElement, type Element } from "@/lib/client/elements";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { uploadToLibrary } from "@/lib/client/library";
import {
  ELEMENT_MEDIA,
  ELEMENT_NAME,
  ELEMENT_NAME_HINT,
  elementMedia,
  elementSummary,
  expandMentions,
  MAX_ELEMENT_DESCRIPTION,
  MAX_ELEMENT_IMAGES,
  type ElementMediaKind,
} from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import {
  Alert,
  Button,
  cx,
  Field,
  inputClass,
  textareaClass,
} from "@/app/components/ui/primitives";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import ElementCover from "./ElementCover";

// --------------------------------------------------
// CREATE OR EDIT AN ELEMENT (window)
//
// New elements go through two steps: reference files
// (images, videos and voice clips, uploaded or picked
// from the media library; at least one), then a name and
// description, with a preview of how a prompt using it
// is sent. Editing shows both on one page.
// --------------------------------------------------

type Step = "files" | "details";

const STEPS: { id: Step; label: string }[] = [
  { id: "files", label: "References" },
  { id: "details", label: "Name & details" },
];

type Lists = { images: string[]; videos: string[]; audios: string[] };

// A file still uploading: its kind, local preview and
// 0–100
type Pending = { kind: ElementMediaKind; preview: string; name: string; progress: number | null };

// "video/mp4" → "video"
const kindOf = (file: File): ElementMediaKind | null =>
  ELEMENT_MEDIA.find((media) => file.type.startsWith(`${media.kind}/`))?.kind ?? null;

export default function ElementDialog({
  element,
  initialName = "",
  initial = {},
  onClose,
  onSaved,
}: {
  // null: a new element
  element: Element | null;
  // Prefilled name for a new one (e.g. what was typed
  // after @)
  initialName?: string;
  // Files a new one starts with (e.g. a generated
  // result: "Add to element")
  initial?: Partial<Lists>;
  onClose: () => void;
  onSaved?: (element: Element) => void;
}) {
  const creating = element === null;

  const [step, setStep] = useState<Step>("files");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [name, setName] = useState(element?.name ?? initialName);
  const [description, setDescription] = useState(element?.description ?? "");
  const [lists, setLists] = useState<Lists>({
    images: element?.images ?? initial.images ?? [],
    videos: element?.videos ?? initial.videos ?? [],
    audios: element?.audios ?? initial.audios ?? [],
  });
  const { images } = lists;
  const [pending, setPending] = useState<Pending[]>([]);
  // The kind being picked from the library
  const [picking, setPicking] = useState<ElementMediaKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const trimmed = name.trim().replace(/^@/, "");
  const nameError = trimmed && !ELEMENT_NAME.test(trimmed) ? ELEMENT_NAME_HINT : "";
  // Free places for one kind, counting uploads under way
  const room = (kind: ElementMediaKind) => {
    const media = elementMedia(kind);
    return media.max - lists[media.list].length - pending.filter((item) => item.kind === kind).length;
  };
  const uploading = pending.length > 0;
  const fileCount = images.length + lists.videos.length + lists.audios.length;

  const filesReady = fileCount > 0 && !uploading;
  const detailsReady = Boolean(trimmed) && !nameError;

  const addFiles = (kind: ElementMediaKind, urls: string[]) => {
    const media = elementMedia(kind);
    setLists((previous) => ({
      ...previous,
      [media.list]: [...previous[media.list], ...urls.filter((url) => !previous[media.list].includes(url))].slice(0, media.max),
    }));
  };

  const removeFile = (kind: ElementMediaKind, url: string) => {
    const { list } = elementMedia(kind);
    setLists((previous) => ({ ...previous, [list]: previous[list].filter((item) => item !== url) }));
  };

  // Each file goes to its kind's list (images, videos,
  // voice clips), up to that list's limit
  async function upload(files: File[], only?: ElementMediaKind) {
    setError("");
    const free = Object.fromEntries(ELEMENT_MEDIA.map((media) => [media.kind, room(media.kind)])) as Record<ElementMediaKind, number>;
    const accepted: [File, ElementMediaKind][] = [];
    let full = "";

    for (const file of files) {
      const kind = kindOf(file);
      if (!kind || (only && kind !== only)) continue;
      if (free[kind] <= 0) {
        full = `Up to ${elementMedia(kind).max} ${elementMedia(kind).many}.`;
        continue;
      }
      free[kind] -= 1;
      accepted.push([file, kind]);
    }

    if (!accepted.length) {
      if (files.length) setError(full || "Please choose image, video or audio files.");
      return;
    }
    if (full) setError(full);

    await Promise.all(
      accepted.map(async ([file, kind]) => {
        const preview = URL.createObjectURL(file);
        setPending((list) => [...list, { kind, preview, name: file.name, progress: null }]);

        try {
          const url = await uploadToLibrary(file, (progress) =>
            setPending((list) => list.map((item) => (item.preview === preview ? { ...item, progress } : item)))
          );
          if (!url) throw new Error("Your library isn't set up on this server, so files can't be saved.");
          addFiles(kind, [url]);
        } catch (err) {
          logRequestError(err);
          setError(errorMessage(err, `Couldn't upload ${file.name}.`));
        } finally {
          setPending((list) => list.filter((item) => item.preview !== preview));
          URL.revokeObjectURL(preview);
        }
      })
    );
  }

  const { dragging, dropProps } = useFileDrop((files) => void upload(files));

  // Each step starts on its main control
  const stepBox = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    stepBox.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step]);

  function go(next: Step) {
    setDirection(STEPS.findIndex((item) => item.id === next) > STEPS.findIndex((item) => item.id === step) ? "forward" : "back");
    setStep(next);
  }

  async function save(close: () => void) {
    setSaving(true);
    setError("");

    try {
      const saved = await saveElement(element?.id ?? null, { name: trimmed, description, ...lists });
      onSaved?.(saved);
      close();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't save the element."));
      setSaving(false);
      // A taken name is fixed on the details step
      if (creating) go("details");
    }
  }

  async function remove(close: () => void) {
    if (!element) return;

    setSaving(true);
    try {
      await removeElement(element.id);
      close();
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't delete the element."));
      setSaving(false);
    }
  }

  // ---------- Sections ----------

  const pendingImages = pending.filter((item) => item.kind === "image");

  const imagesSection = (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-fg">Images</p>
        <span className="text-xs tabular-nums text-fg-subtle">
          {images.length + pendingImages.length} / {MAX_ELEMENT_IMAGES}
        </span>
      </div>

      {images.length === 0 && pendingImages.length === 0 ? (
        <button
          type="button"
          data-autofocus
          onClick={() => setPicking("image")}
          className={cx(
            "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200",
            dragging
              ? "scale-[1.01] border-accent bg-accent-soft ring-4 ring-accent/15"
              : "border-line-strong bg-sunken hover:border-accent"
          )}
        >
          <span className={cx("flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-fg-muted transition-transform duration-300", dragging && "-translate-y-1 scale-110 text-accent")}>
            <Icon name="image" size={22} />
          </span>
          <span className="mt-4 text-sm font-medium text-fg">
            {dragging ? "Drop to upload" : "Add 1–7 images of it"}
          </span>
          <span className="mt-1 text-xs text-fg-subtle">Upload, pick from your library or results, or drag & drop</span>
        </button>
      ) : (
        <ul className={cx("grid grid-cols-4 gap-2 rounded-xl transition-colors", dragging && "bg-accent-soft ring-2 ring-accent/30")}>
          {images.map((url, index) => (
            <li
              key={url}
              className="ui-rise group relative aspect-square overflow-hidden rounded-lg border border-line bg-black"
              style={{ "--i": index } as React.CSSProperties}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Reference ${index + 1}`} className="h-full w-full object-cover" />

              {index === 0 ? (
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                  Cover
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setLists((previous) => ({ ...previous, images: [url, ...previous.images.filter((item) => item !== url)] }))}
                  className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 backdrop-blur transition-opacity hover:bg-black focus-visible:opacity-100 group-hover:opacity-100"
                >
                  Make cover
                </button>
              )}

              <button
                type="button"
                aria-label={`Remove image ${index + 1}`}
                onClick={() => removeFile("image", url)}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white opacity-0 backdrop-blur transition-opacity hover:bg-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-90"
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}

          {pendingImages.map((item) => (
            <li key={item.preview} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.preview} alt="" className="h-full w-full scale-105 object-cover opacity-50 blur-[1px]" />
              <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/25">
                <span
                  className={cx("block h-full rounded-full bg-white transition-[width] duration-300", item.progress === null && "w-1/3 animate-pulse")}
                  style={item.progress === null ? undefined : { width: `${item.progress}%` }}
                />
              </span>
              <span className="sr-only">Uploading</span>
            </li>
          ))}

          {room("image") > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setPicking("image")}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-sunken text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
              >
                <Icon name="upload" size={16} />
                Add
              </button>
            </li>
          )}
        </ul>
      )}

      <p className="text-xs text-fg-subtle">
        The same character or object from a few angles works best. The first image is its cover.
      </p>
    </div>
  );

  const filesSection = (
    <div {...dropProps} className={cx("space-y-6 rounded-xl transition-colors", dragging && "bg-accent-soft/40")}>
      {imagesSection}
      <ClipList
        kind="video"
        title="Reference videos"
        hint="How it moves: sent to models that take reference videos."
        urls={lists.videos}
        pending={pending.filter((item) => item.kind === "video")}
        room={room("video")}
        onAdd={() => setPicking("video")}
        onRemove={(url) => removeFile("video", url)}
      />
      <ClipList
        kind="audio"
        title="Voice"
        hint="How it sounds: sent to models that take reference audio."
        urls={lists.audios}
        pending={pending.filter((item) => item.kind === "audio")}
        room={room("audio")}
        onAdd={() => setPicking("audio")}
        onRemove={(url) => removeFile("audio", url)}
      />
      <p className="border-t border-line pt-3 text-xs text-fg-subtle">
        Add at least one image, video or voice clip. When you mention @it, each goes into the model&apos;s
        matching input; ones a model can&apos;t take are left out.
      </p>
    </div>
  );

  const detailsSection = (
    <div className="space-y-4">
      <Field label="Name" required error={nameError} hint={nameError ? undefined : "No spaces: you'll type it after @ in prompts"}>
        {(control) => (
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-accent">
              @
            </span>
            <input
              {...control}
              data-autofocus
              value={name}
              maxLength={41}
              autoComplete="off"
              onChange={(event) => setName(event.target.value.replace(/\s/g, "_"))}
              placeholder="maya"
              className={cx(inputClass, "pl-7")}
            />
          </div>
        )}
      </Field>

      <Field label="Description" hint="Tells the model what it is: it replaces @name when a run is sent.">
        {(control) => (
          <div className="relative">
            <textarea
              {...control}
              rows={3}
              value={description}
              maxLength={MAX_ELEMENT_DESCRIPTION}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="a woman in her 30s with red curly hair and a green raincoat"
              className={cx(textareaClass, "resize-none pb-6")}
            />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-fg-subtle">
              {description.length} / {MAX_ELEMENT_DESCRIPTION}
            </span>
          </div>
        )}
      </Field>

      <Preview name={trimmed || "name"} description={description} files={lists} />
    </div>
  );

  // ---------- Window ----------

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <>
      <Modal
        title={creating ? "New element" : `Edit @${element.name}`}
        subtitle={creating ? "A character, product or object you can drop into any prompt with @" : undefined}
        onClose={onClose}
        header={() =>
          creating ? (
            <ol className="flex items-center gap-2 px-5 pb-3 pt-1" aria-label="Steps">
              {STEPS.map((item, index) => {
                const done = index < stepIndex;
                const current = index === stepIndex;

                return (
                  <li key={item.id} className="flex flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
                    <button
                      type="button"
                      disabled={index > stepIndex && !filesReady}
                      onClick={() => go(item.id)}
                      className="flex items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <span
                        className={cx(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                          current && "bg-accent text-on-accent ring-4 ring-accent/20",
                          done && "bg-accent-soft text-accent",
                          !current && !done && "bg-raised text-fg-subtle"
                        )}
                      >
                        {done ? <Icon name="check" size={12} /> : index + 1}
                      </span>
                      <span className={cx("text-xs font-medium transition-colors", current ? "text-fg" : "text-fg-subtle")}>
                        {item.label}
                      </span>
                    </button>
                    {index < STEPS.length - 1 && (
                      <span className="relative h-px flex-1 overflow-hidden bg-line">
                        <span
                          className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out"
                          style={{ width: done ? "100%" : "0%" }}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : null
        }
      >
        {(close) => (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (creating && step === "files") {
                if (filesReady) go("details");
              } else if (filesReady && detailsReady && !saving) {
                void save(close);
              }
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-line p-5">
              {error && (
                <div className="ui-rise mb-4">
                  <Alert>{error}</Alert>
                </div>
              )}

              {creating ? (
                <div ref={stepBox} key={step} className={direction === "forward" ? "ui-step-forward" : "ui-step-back"}>
                  {step === "files" ? filesSection : detailsSection}
                </div>
              ) : (
                <div className="space-y-6">
                  {filesSection}
                  {detailsSection}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              {!creating ? (
                confirmDelete ? (
                  <span className="ui-menu flex items-center gap-2 text-sm">
                    <span className="text-fg-muted">Delete @{element.name}?</span>
                    <Button size="sm" variant="danger" disabled={saving} onClick={() => void remove(close)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" icon="trash" className="text-danger hover:text-danger" disabled={saving} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )
              ) : step === "details" ? (
                <Button variant="ghost" icon="chevronLeft" onClick={() => go("files")}>
                  Back
                </Button>
              ) : (
                <span />
              )}

              {!confirmDelete && (
                <div className="flex gap-2">
                  {!creating && (
                    <Button variant="ghost" onClick={close}>
                      Cancel
                    </Button>
                  )}
                  {creating && step === "files" ? (
                    <Button type="submit" variant="primary" disabled={!filesReady}>
                      {uploading ? "Uploading…" : "Next"}
                      <Icon name="chevronRight" size={16} />
                    </Button>
                  ) : (
                    <Button type="submit" variant="primary" disabled={!filesReady || !detailsReady || saving}>
                      {saving ? "Saving…" : creating ? "Create element" : "Save changes"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </form>
        )}
      </Modal>

      {picking && (
        <MediaLibraryDialog
          kind={picking}
          multiple
          title={picking === "image" ? "Add reference images" : picking === "video" ? "Add reference videos" : "Add voice clips"}
          inField={lists[elementMedia(picking).list]}
          onUpload={(files) => void upload(files, picking)}
          onPick={(urls) => addFiles(picking, urls)}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

// Reference videos or voice clips: one row each, with a
// player, and an Add button while there's room
function ClipList({
  kind,
  title,
  hint,
  urls,
  pending,
  room,
  onAdd,
  onRemove,
}: {
  kind: "video" | "audio";
  title: string;
  hint: string;
  urls: string[];
  pending: Pending[];
  room: number;
  onAdd: () => void;
  onRemove: (url: string) => void;
}) {
  const media = elementMedia(kind);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-fg">
          {title} <span className="font-normal text-fg-subtle">· optional</span>
        </p>
        <span className="text-xs tabular-nums text-fg-subtle">
          {urls.length + pending.length} / {media.max}
        </span>
      </div>

      {(urls.length > 0 || pending.length > 0) && (
        <ul className="space-y-1.5">
          {urls.map((url, index) => (
            <li key={url} className="ui-rise flex items-center gap-2.5 rounded-lg border border-line bg-sunken p-1.5">
              {kind === "video" ? (
                <video src={`${url}#t=0.1`} controls muted playsInline preload="metadata" className="h-14 w-24 shrink-0 rounded-md bg-black object-cover" />
              ) : (
                <audio src={url} controls preload="metadata" className="h-9 min-w-0 flex-1" />
              )}
              {kind === "video" && <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">Video {index + 1}</span>}
              <button
                type="button"
                aria-label={`Remove ${media.one} ${index + 1}`}
                onClick={() => onRemove(url)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-raised hover:text-danger"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}

          {pending.map((item) => (
            <li key={item.preview} className="flex items-center gap-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5 text-xs text-fg-muted">
              <Icon name={kind} size={14} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="h-1 w-20 overflow-hidden rounded-full bg-raised">
                <span
                  className={cx("block h-full rounded-full bg-accent transition-[width] duration-300", item.progress === null && "w-1/3 animate-pulse")}
                  style={item.progress === null ? undefined : { width: `${item.progress}%` }}
                />
              </span>
              <span className="sr-only">Uploading</span>
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong bg-sunken px-3 py-2.5 text-left text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
        >
          <Icon name={kind} size={16} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-fg">Add {media.one}</span>
            <span className="block text-fg-subtle">{hint}</span>
          </span>
          <Icon name="upload" size={14} />
        </button>
      )}
    </div>
  );
}

// How the element shows in the @ list, and how a prompt
// using it is sent
function Preview({
  name,
  description,
  files,
}: {
  name: string;
  description: string;
  files: Lists;
}) {
  const sample = `A photo of @${name} on a rainy street`;
  const sent = expandMentions(sample, [
    { id: "preview", name, description, images: [], videos: [], audios: [], createdAt: "", updatedAt: "" },
  ]);

  return (
    <div className="rounded-xl border border-line bg-sunken p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">Preview</p>

      <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-surface p-2 shadow-sm">
        <ElementCover element={files} iconSize={14} className="h-8 w-8 rounded-md" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">@{name}</span>
          <span className="block truncate text-xs text-fg-subtle">
            {description.trim() || elementSummary(files)}
          </span>
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <p className="text-fg-muted">
          You type: <span className="text-fg">A photo of <span className="rounded bg-accent-soft px-1 font-medium text-accent">@{name}</span> on a rainy street</span>
        </p>
        <p className="text-fg-muted">
          Model gets: <span className="text-fg">{sent}</span>
        </p>
      </div>
    </div>
  );
}

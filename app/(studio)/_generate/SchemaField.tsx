"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useGenerate } from "@/app/(studio)/_generate/GenerateProvider";
import { Icon } from "@/app/components/ui/Icon";
import {
  Button,
  cx,
  Field,
  inputClass,
  Spinner,
  textareaClass,
} from "@/app/components/ui/primitives";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import MediaCaption from "./MediaCaption";
import MediaLibraryDialog from "./MediaLibraryDialog";
import MediaPreviewDialog, { type MediaPreview } from "./MediaPreviewDialog";
import {
  fieldLabel,
  fileKind,
  StableTextArea,
  type FileKind,
  type SchemaProperty,
} from "./fields";

// --------------------------------------------------
// ONE CONTROL PER SCHEMA FIELD
//
// Built on <Field> so every input has a linked label
// and help text.
// --------------------------------------------------

// Second line of the upload row
const ROW_HINT = "Upload or pick from library";

export default function SchemaField({
  fieldKey: key,
  field,
}: {
  fieldKey: string;
  field: SchemaProperty;
}) {
  const { inputs, updateInput, schema, model } = useGenerate();

  const value = inputs[key];
  const label = fieldLabel(key, field, { schema, model });
  const kind = fileKind(key, field);
  const lowerKey = key.toLowerCase();

  const isLong =
    lowerKey.includes("description") || lowerKey.includes("negative");

  // ENUM
  if (field.enum?.length) {
    return (
      <Field label={label} info={field.description}>
        {(control) => (
          <select
            {...control}
            value={String(value ?? "")}
            onChange={(event) => updateInput(key, event.target.value)}
            className={inputClass}
          >
            {field.enum!.map((option) => (
              <option key={option} value={option}>
                {field.enumLabels?.[option] ?? option}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  // BOOLEAN: same shape as the other settings (label on
  // top, a 40px control below), so it lines up with
  // dropdowns in the settings grid
  if (field.type === "boolean") {
    const on = Boolean(value);

    return (
      <Field label={label} info={field.description}>
        {(control) => (
          <label
            className={cx(
              "flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-sm transition-colors",
              on
                ? "border-accent bg-accent-soft text-fg"
                : "border-line bg-sunken text-fg-muted hover:border-line-strong",
            )}
          >
            <input
              {...control}
              type="checkbox"
              checked={on}
              onChange={(event) => updateInput(key, event.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {on ? "On" : "Off"}
          </label>
        )}
      </Field>
    );
  }

  // NUMBER
  if (field.type === "number" || field.type === "integer") {
    const range =
      field.minimum !== undefined && field.maximum !== undefined
        ? `Between ${field.minimum} and ${field.maximum}.`
        : "";

    return (
      <Field
        label={label}
        info={[field.description, range].filter(Boolean).join(" ") || undefined}
      >
        {(control) => (
          <input
            {...control}
            type="number"
            inputMode="decimal"
            value={value === "" ? "" : String(value ?? "")}
            min={field.minimum}
            max={field.maximum}
            step={field.type === "integer" ? 1 : "any"}
            onChange={(event) =>
              updateInput(
                key,
                event.target.value === "" ? "" : Number(event.target.value)
              )
            }
            className={inputClass}
          />
        )}
      </Field>
    );
  }

  // FILE (image / video / audio)
  if (kind) {
    return <FileField fieldKey={key} field={field} kind={kind} label={label} />;
  }

  // LONG TEXT
  if (isLong) {
    return (
      <Field label={label} info={field.description}>
        {(control) => (
          <StableTextArea
            {...control}
            rows={4}
            value={String(value ?? "")}
            onChange={(next) => updateInput(key, next)}
            placeholder={`Enter ${label.toLowerCase()}…`}
            className={textareaClass}
          />
        )}
      </Field>
    );
  }

  // NORMAL TEXT
  return (
    <Field label={label} info={field.description}>
      {(control) => (
        <input
          {...control}
          value={String(value ?? "")}
          onChange={(event) => updateInput(key, event.target.value)}
          className={inputClass}
        />
      )}
    </Field>
  );
}

function FileField({
  fieldKey: key,
  field,
  kind,
  label,
}: {
  fieldKey: string;
  field: SchemaProperty;
  kind: FileKind;
  label: string;
}) {
  const {
    inputs,
    updateInput,
    uploading,
    pendingUploads,
    uploadFile,
    filePreviews,
    fileNotes,
    removeImage,
    setError,
  } = useGenerate();

  const value = inputs[key];
  // Images, and any list field (e.g. a model's reference
  // videos), take several files; otherwise one
  const single = kind !== "image" && field.type !== "array";
  const busy = (uploading[key] ?? 0) > 0;

  const noun = kind === "audio" ? "audio file" : kind;
  const nouns = `${noun}s`;
  const aNoun = kind === "image" ? "an image" : kind === "audio" ? "an audio file" : "a video";

  // Shared by the picker and drag & drop. A drop can hold
  // any file type, so keep only this field's kind.
  function addFiles(files: File[]) {
    const matching = files.filter((file) => file.type.startsWith(`${kind}/`));

    if (!matching.length) {
      if (files.length) setError(`Please drop ${single ? aNoun : nouns}.`);
      return;
    }

    (single ? matching.slice(0, 1) : matching).forEach((file) =>
      uploadFile(key, file, !single)
    );
  }

  const { dragging, dropProps } = useFileDrop(addFiles);

  const [viewing, setViewing] = useState<MediaPreview | null>(null);
  // The upload / library window
  const [picking, setPicking] = useState(false);

  // Files picked from the library: no upload needed
  function pickFiles(urls: string[]) {
    if (single) {
      updateInput(key, urls[0] ?? "");
      return;
    }

    const current = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    updateInput(key, [...current, ...urls.filter((url) => !current.includes(url))]);
  }

  // Open from a tile: its box and the media's real size
  // let the popup grow out of it
  function openPreview(trigger: HTMLElement, src: string, sizeOf: string | null) {
    const tile = trigger.parentElement!;
    const media = tile.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
    const video = media instanceof HTMLVideoElement ? media : null;
    const image = media instanceof HTMLImageElement ? media : null;

    setViewing({
      src,
      kind: kind === "video" ? "video" : "image",
      alt: label,
      origin: tile.getBoundingClientRect(),
      width: video?.videoWidth ?? image?.naturalWidth ?? 0,
      height: video?.videoHeight ?? image?.naturalHeight ?? 0,
      sizeOf,
    });
  }

  // The field's files, when it takes several
  const files = single
    ? []
    : Array.isArray(value)
      ? value
      : typeof value === "string" && value
        ? [value]
        : [];

  const singleUrl =
    single && typeof value === "string" && value ? value : null;

  // Files of this field still uploading
  const pending = pendingUploads[key] ?? [];
  const singlePending = single ? (pending.at(-1) ?? null) : null;
  const singleSrc = singlePending
    ? singlePending.preview
    : singleUrl
      ? (filePreviews[singleUrl] ?? singleUrl)
      : null;

  // Uploaded files, then those still uploading, in one
  // list so a tile stays the same element when done
  // `url`: the uploaded file (for its size), once there is one
  const tiles: { src: string; url: string | null; index: number | null; progress?: number | null }[] = [
    ...files.map((file, index) => ({
      src: filePreviews[String(file)] ?? String(file),
      url: String(file),
      index,
    })),
    ...(single ? [] : pending.map((item) => ({ ...item, src: item.preview, url: null, index: null }))),
    // A video is one tile too: uploaded, or the newest
    // one still uploading
    ...(kind === "video" && single && singleSrc
      ? [
          {
            src: singleSrc,
            url: singlePending ? null : singleUrl,
            index: singlePending ? null : 0,
            progress: singlePending ? singlePending.progress : undefined,
          },
        ]
      : []),
  ];


  return (
    <Field label={label} info={field.description}>
      {(control) => (
        <div className="space-y-3">
          <button
            type="button"
            {...control}
            {...dropProps}
            onClick={() => setPicking(true)}
            className={cx(
              // One slim row, so uploads don't crowd the prompt
              "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
              dragging
                ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                : "border-line-strong bg-sunken hover:border-accent hover:bg-accent-soft/40"
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised">
              {busy ? (
                <Spinner className="text-accent" />
              ) : (
                <Icon name="upload" size={16} className="text-fg-muted" />
              )}
            </span>

            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">
                {dragging
                  ? `Drop ${single ? `the ${noun}` : nouns} here`
                  : busy
                    ? "Uploading…"
                    : singleUrl
                      ? `Replace ${noun}`
                      : `Add ${single ? aNoun : nouns}`}
              </span>

              <span className="block truncate text-xs text-fg-subtle" title={ROW_HINT}>
                {ROW_HINT}
              </span>
            </span>
          </button>

          {/* AUDIO: the newest file, played inline */}
          {kind === "audio" && singleSrc && (
            <PreviewTile
              key={singleSrc}
              className="rounded-lg border border-line bg-sunken p-2 pr-24"
              progress={singlePending ? singlePending.progress : undefined}
            >
              {(mediaClass) => (
                <>
                  <audio src={singleSrc} controls className={cx("w-full", mediaClass)} />

                  {!singlePending && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute right-2 top-1/2 z-10 -translate-y-1/2"
                      onClick={() => updateInput(key, "")}
                    >
                      Remove
                    </Button>
                  )}
                </>
              )}
            </PreviewTile>
          )}

          {/* AUDIO LIST: each file played inline */}
          {kind === "audio" && !single && tiles.length > 0 && (
            <ul className="space-y-2">
              {tiles.map((tile) => (
                <PreviewTile
                  key={tile.src}
                  as="li"
                  className="rounded-lg border border-line bg-sunken p-2 pr-12"
                  progress={tile.progress}
                >
                  {(mediaClass) => (
                    <>
                      <audio src={tile.src} controls className={cx("w-full", mediaClass)} />

                      {tile.index !== null && (
                        <button
                          type="button"
                          aria-label={`Remove ${label} ${tile.index + 1}`}
                          onClick={() => removeImage(key, tile.index!)}
                          className="absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted hover:bg-raised hover:text-fg"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </>
                  )}
                </PreviewTile>
              ))}
            </ul>
          )}

          {/* IMAGE / VIDEO TILES, keyed by the local preview */}
          {kind !== "audio" && tiles.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {tiles.map((tile) => (
                <PreviewTile
                  key={tile.src}
                  as="li"
                  className={cx(
                    "group h-16 rounded-lg border border-line bg-black",
                    kind === "video" ? "w-28" : "w-16"
                  )}
                  progress={tile.progress}
                >
                  {(mediaClass) => (
                    <>
                      {kind === "video" ? (
                        <video
                          src={tile.src}
                          muted
                          playsInline
                          preload="metadata"
                          className={cx("h-full w-full object-cover", mediaClass)}
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tile.src}
                          alt=""
                          className={cx("h-full w-full object-cover", mediaClass)}
                        />
                      )}

                      {/* Whole tile opens the full-size preview */}
                      <button
                        type="button"
                        aria-label={`Preview ${
                          tile.index === null
                            ? `${label} (uploading)`
                            : single
                              ? label
                              : `${label} ${tile.index + 1}`
                        }`}
                        onClick={(event) => openPreview(event.currentTarget, tile.src, tile.url)}
                        className="absolute inset-0 flex cursor-zoom-in items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      >
                        {kind === "video" && tile.progress === undefined && (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-110">
                            <Icon name="play" size={14} />
                          </span>
                        )}
                      </button>

                      {tile.progress === undefined && tile.index !== null && (
                        <MediaCaption src={tile.src} kind={kind} />
                      )}

                      {tile.index !== null && (
                        <button
                          type="button"
                          aria-label={`Remove ${label}${single ? "" : ` ${tile.index + 1}`}`}
                          onClick={() =>
                            single
                              ? updateInput(key, "")
                              : removeImage(key, tile.index!)
                          }
                          className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-md bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-90"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </>
                  )}
                </PreviewTile>
              ))}
            </ul>
          )}

          {/* e.g. a video resized so the model accepts it */}
          {(single ? (singleUrl ? [singleUrl] : []) : files.map(String))
            .filter((url) => fileNotes[url])
            .map((url) => (
              <p key={url} className="ui-rise flex items-center gap-1.5 text-xs text-fg-subtle" role="status">
                <Icon name="info" size={12} />
                {fileNotes[url]}
              </p>
            ))}

          {viewing && (
            <MediaPreviewDialog preview={viewing} onClose={() => setViewing(null)} />
          )}

          {picking && (
            <MediaLibraryDialog
              kind={kind}
              multiple={!single}
              title={
                // "Add images", plus the field's name when it says more
                label.toLowerCase().startsWith(noun)
                  ? `Add ${single ? aNoun : nouns}`
                  : `Add ${single ? aNoun : nouns} · ${label}`
              }
              inField={single ? (singleUrl ? [singleUrl] : []) : files.map(String)}
              onUpload={addFiles}
              onPick={pickFiles}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </Field>
  );
}

// --------------------------------------------------
// PREVIEW TILE
//
// Grows in when added. While its file uploads (progress
// set), the media is dimmed and soft under a progress
// ring; when the upload finishes it eases into focus.
// --------------------------------------------------

const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function PreviewTile({
  as: Tag = "div",
  className,
  progress,
  children,
}: {
  as?: "div" | "li";
  className?: string;
  // undefined: not uploading; null: uploading, no progress
  progress?: number | null;
  children: (mediaClass: string) => ReactNode;
}) {
  const tile = useRef<HTMLElement>(null);
  const uploading = progress !== undefined;

  // Web Animations, not a CSS class: reordering tiles
  // must not replay it
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    tile.current?.animate(
      [
        { opacity: 0, transform: "scale(0.88)", filter: "blur(6px)" },
        { opacity: 1, transform: "scale(1)", filter: "blur(0)" },
      ],
      { duration: 380, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)" }
    );
  }, []);

  return (
    <Tag
      ref={tile as never}
      className={cx("relative overflow-hidden", className)}
      aria-busy={uploading || undefined}
    >
      {children(
        cx(
          "transition-[filter,transform] duration-500 ease-out",
          uploading && "scale-[1.04] blur-[2px] brightness-75"
        )
      )}

      <div
        aria-hidden={!uploading}
        className={cx(
          "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-500",
          uploading ? "opacity-100" : "opacity-0"
        )}
      >
        {uploading && (
          <span className="relative flex h-10 w-10 items-center justify-center">
            <svg
              viewBox="0 0 36 36"
              className={cx(
                "absolute inset-0 -rotate-90",
                progress === null && "animate-spin"
              )}
            >
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="3"
                className="stroke-white/25"
              />
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                stroke="#00CCDD"
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={
                  RING_LENGTH * (1 - (progress === null ? 0.3 : progress / 100))
                }
                className="transition-[stroke-dashoffset] duration-300 ease-out"
              />
            </svg>

            {progress !== null && (
              <span className="text-[10px] font-semibold tabular-nums text-white">
                {Math.round(progress)}
              </span>
            )}
          </span>
        )}
        {uploading && <span className="sr-only">Uploading</span>}
      </div>
    </Tag>
  );
}

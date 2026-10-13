"use client";

import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
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

// Second line of the upload row; the full detail is in
// its tooltip
const ACCEPT_HINTS = {
  image: "or drag & drop · up to 100 MB each",
  video: "or drag & drop · MP4, MOV, WEBM · 100 MB",
  audio: "or drag & drop · MP3, WAV, M4A · 100 MB",
};

export default function SchemaField({
  fieldKey: key,
  field,
}: {
  fieldKey: string;
  field: SchemaProperty;
}) {
  const { inputs, updateInput } = useGenerate();

  const value = inputs[key];
  const label = fieldLabel(key, field);
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
                {option}
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
    uploadFile,
    filePreviews,
    removeImage,
    setError,
  } = useGenerate();

  const value = inputs[key];
  const single = kind !== "image";
  const busy = (uploading[key] ?? 0) > 0;

  // Shared by the picker and drag & drop. A drop can hold
  // any file type, so keep only this field's kind.
  function addFiles(files: File[]) {
    const matching = files.filter((file) => file.type.startsWith(`${kind}/`));

    if (!matching.length) {
      if (files.length) setError(`Please drop ${single ? `a ${kind}` : "image"} file.`);
      return;
    }

    (single ? matching.slice(0, 1) : matching).forEach((file) =>
      uploadFile(key, file)
    );
  }

  const { dragging, dropProps } = useFileDrop(addFiles);

  const images =
    kind === "image"
      ? Array.isArray(value)
        ? value
        : typeof value === "string" && value
          ? [value]
          : []
      : [];

  const singleUrl =
    single && typeof value === "string" && value ? value : null;

  return (
    <Field label={label} info={field.description}>
      {(control) => (
        <div className="space-y-3">
          <label
            htmlFor={control.id}
            {...dropProps}
            className={cx(
              // One slim row, so uploads don't crowd the prompt
              "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
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
                  ? `Drop ${single ? `the ${kind}` : "images"} here`
                  : busy
                    ? "Uploading…"
                    : singleUrl
                      ? `Replace ${kind}`
                      : `Add ${single ? `a ${kind}` : "images"}`}
              </span>

              <span className="block truncate text-xs text-fg-subtle" title={ACCEPT_HINTS[kind]}>
                {ACCEPT_HINTS[kind]}
              </span>
            </span>

            <input
              {...control}
              type="file"
              accept={`${kind}/*`}
              multiple={!single}
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </label>

          {/* VIDEO / AUDIO PREVIEW */}
          {singleUrl && (
            <div className="relative overflow-hidden rounded-lg border border-line bg-black">
              {kind === "video" ? (
                <video
                  src={singleUrl}
                  controls
                  playsInline
                  className="max-h-64 w-full object-contain"
                />
              ) : (
                <audio src={singleUrl} controls className="w-full" />
              )}

              <Button
                size="sm"
                variant="secondary"
                className="absolute right-2 top-2"
                onClick={() => updateInput(key, "")}
              >
                Remove
              </Button>
            </div>
          )}

          {/* IMAGE PREVIEWS */}
          {images.length > 0 && (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {images.map((image, index) => (
                <li
                  key={`${String(image)}-${index}`}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-black"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={filePreviews[String(image)] ?? String(image)}
                    alt={`${label} ${index + 1}`}
                    className="h-full w-full object-cover"
                  />

                  <button
                    type="button"
                    aria-label={`Remove ${label} ${index + 1}`}
                    onClick={() => removeImage(key, index)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white opacity-90 transition-opacity hover:opacity-100"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

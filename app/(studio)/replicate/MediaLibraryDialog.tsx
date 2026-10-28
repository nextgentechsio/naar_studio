"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { logRequestError } from "@/lib/client/http";
import {
  deleteFromLibrary,
  fetchLibrary,
  onLibraryChange,
  type LibraryFile,
} from "@/lib/client/library";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Button, cx, EmptyState, inputClass } from "@/app/components/ui/primitives";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import type { FileKind } from "./fields";
import MediaCaption from "./MediaCaption";

// --------------------------------------------------
// ADD FILES TO AN UPLOAD FIELD (window)
//
// Upload: new files, saved to the user's library as
// they upload. Library: everything saved before, picked
// to reuse without uploading again (double-click adds
// one at once), searched, or deleted.
// --------------------------------------------------

type Tab = "upload" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "library", label: "Library" },
];

const UPLOAD_HINTS: Record<FileKind, string> = {
  image: "PNG, JPEG, WEBP or GIF · up to 100 MB each",
  video: "MP4, MOV or WEBM · up to 100 MB",
  audio: "MP3, WAV or M4A · up to 100 MB",
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function MediaLibraryDialog({
  kind,
  multiple,
  title,
  inField,
  onUpload,
  onPick,
  onClose,
}: {
  kind: FileKind;
  multiple: boolean;
  title: string;
  // URLs the field already has (shown as added)
  inField: string[];
  onUpload: (files: File[]) => void;
  onPick: (urls: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // The file asking "Delete?", and the one being deleted
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const noun = kind === "audio" ? "audio file" : kind;
  const nouns = `${noun}s`;

  const load = useCallback(async () => {
    try {
      const data = await fetchLibrary(kind);
      setEnabled(data.enabled);
      setFiles(data.files);
    } catch (err) {
      logRequestError(err);
      setError("Couldn't load your library.");
      setFiles((previous) => previous ?? []);
    }
  }, [kind]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads on open
  useEffect(() => void load(), [load]);
  useEffect(() => onLibraryChange(() => void load()), [load]);

  const shown = (files ?? []).filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function remove(file: LibraryFile) {
    setConfirming(null);
    setDeleting(file.id);
    try {
      await deleteFromLibrary(file.id);
      setSelected((previous) => previous.filter((url) => url !== file.url));
    } catch (err) {
      logRequestError(err);
      setError("Couldn't delete the file.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      header={() => (
        <Tabs
          tab={tab}
          onChange={setTab}
          count={files?.length ?? 0}
        />
      )}
    >
      {(close) => {
        function upload(chosen: File[]) {
          const matching = chosen.filter((file) => file.type.startsWith(`${kind}/`));

          if (!matching.length) {
            setError(`Please choose ${multiple ? nouns : `a ${noun}`}.`);
            return;
          }

          onUpload(multiple ? matching : matching.slice(0, 1));
          close();
        }

        function add(urls: string[]) {
          onPick(urls);
          close();
        }

        function toggle(url: string) {
          if (!multiple) return add([url]);

          setSelected((previous) =>
            previous.includes(url) ? previous.filter((item) => item !== url) : [...previous, url]
          );
        }

        return (
          <>
            {error && (
              <p role="alert" className="ui-rise mx-5 mt-3 flex items-center gap-2 text-sm text-danger">
                <Icon name="alert" size={14} />
                {error}
              </p>
            )}

            {tab === "upload" ? (
              <UploadPane
                key="upload"
                kind={kind}
                multiple={multiple}
                enabled={enabled}
                onFiles={upload}
              />
            ) : (
              <div key="library" className="ui-step-forward flex min-h-0 flex-1 flex-col">
                {files && files.length > 6 && (
                  <div className="px-5 pt-4">
                    <div className="relative">
                      <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={`Search ${files.length} ${nouns}`}
                        aria-label={`Search your ${nouns}`}
                        className={cx(inputClass, "h-9 pl-9")}
                      />
                    </div>
                  </div>
                )}

                <div className="min-h-[18rem] flex-1 overflow-y-auto p-5">
                  {files === null ? (
                    <Skeletons kind={kind} />
                  ) : !enabled ? (
                    <EmptyState
                      compact
                      icon="folder"
                      title="Library not available"
                      description="The server has no file storage set up, so uploads aren't kept."
                    />
                  ) : files.length === 0 ? (
                    <EmptyState
                      compact
                      icon={kind === "video" ? "video" : "image"}
                      title={`No ${nouns} yet`}
                      description={`${noun[0].toUpperCase()}${noun.slice(1)}s you upload are kept here, ready to reuse.`}
                      action={
                        <Button size="sm" icon="upload" onClick={() => setTab("upload")}>
                          Upload {multiple ? nouns : `a ${noun}`}
                        </Button>
                      }
                    />
                  ) : shown.length === 0 ? (
                    <p className="py-12 text-center text-sm text-fg-muted">
                      Nothing matches &ldquo;{query}&rdquo;
                    </p>
                  ) : (
                    <ul
                      className={cx(
                        "grid gap-3",
                        kind === "audio" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"
                      )}
                    >
                      {shown.map((file, index) => (
                        <LibraryTile
                          key={file.id}
                          index={index}
                          file={file}
                          kind={kind}
                          added={inField.includes(file.url)}
                          chosen={selected.includes(file.url)}
                          multiple={multiple}
                          confirming={confirming === file.id}
                          deleting={deleting === file.id}
                          onToggle={() => toggle(file.url)}
                          onAddNow={() => add([file.url])}
                          onAskDelete={() => setConfirming(file.id)}
                          onCancelDelete={() => setConfirming(null)}
                          onDelete={() => void remove(file)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                {multiple && files && files.length > 0 && (
                  <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                    <span className="text-sm text-fg-muted" aria-live="polite">
                      {selected.length ? (
                        <>
                          <span className="font-medium text-fg">{selected.length}</span> selected
                          <button
                            type="button"
                            onClick={() => setSelected([])}
                            className="ml-2 text-xs text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        `Select ${nouns} to add · double-click adds one`
                      )}
                    </span>
                    <Button variant="primary" disabled={!selected.length} onClick={() => add(selected)}>
                      Add {selected.length > 1 ? `${selected.length} ${nouns}` : noun}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        );
      }}
    </Modal>
  );
}

// --------------------------------------------------
// TABS with a sliding underline; ← → move between them
// --------------------------------------------------

function Tabs({ tab, onChange, count }: { tab: Tab; onChange: (tab: Tab) => void; count: number }) {
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const active = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active) setBar({ left: active.offsetLeft, width: active.offsetWidth });
  }, [tab, count]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((item) => item.id === tab) + 1) % TABS.length].id;
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <div ref={list} role="tablist" onKeyDown={onKeyDown} className="relative flex gap-6 border-b border-line px-5">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          data-tab={item.id}
          aria-selected={tab === item.id}
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          className={cx(
            "flex items-center gap-1.5 pb-2.5 pt-1 text-sm font-medium transition-colors",
            tab === item.id ? "text-fg" : "text-fg-muted hover:text-fg"
          )}
        >
          <Icon name={item.id === "upload" ? "upload" : "folder"} size={14} />
          {item.label}
          {item.id === "library" && count > 0 && (
            <span className="rounded-full bg-raised px-1.5 text-xs tabular-nums text-fg-muted">{count}</span>
          )}
        </button>
      ))}

      <span
        aria-hidden
        className="absolute -bottom-px h-0.5 rounded-full bg-accent transition-[left,width] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1)]"
        style={bar}
      />
    </div>
  );
}

// --------------------------------------------------
// UPLOAD PANE
// --------------------------------------------------

function UploadPane({
  kind,
  multiple,
  enabled,
  onFiles,
}: {
  kind: FileKind;
  multiple: boolean;
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const { dragging, dropProps } = useFileDrop(onFiles);
  const noun = kind === "audio" ? "audio file" : kind;

  return (
    <div className="ui-step-back p-5">
      <div
        {...dropProps}
        className={cx(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all duration-200",
          dragging
            ? "scale-[1.01] border-accent bg-accent-soft ring-4 ring-accent/15"
            : "border-line-strong bg-sunken"
        )}
      >
        <span
          className={cx(
            "flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-fg-muted transition-transform duration-300",
            dragging && "-translate-y-1 scale-110 text-accent"
          )}
        >
          <Icon name="upload" size={22} />
        </span>
        <p className="mt-4 text-sm font-medium text-fg">
          {dragging
            ? `Drop to upload`
            : `Drag & drop ${multiple ? `${noun}s` : `a ${noun}`} here`}
        </p>
        <p className="mt-1 text-xs text-fg-subtle">{UPLOAD_HINTS[kind]}</p>

        <Button
          variant="primary"
          className="mt-5"
          icon="upload"
          data-autofocus
          onClick={() => picker.current?.click()}
        >
          Choose {multiple ? "files" : "a file"}
        </Button>

        <input
          ref={picker}
          type="file"
          accept={`${kind}/*`}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-label={`Choose ${noun} files`}
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
        <Icon name="info" size={13} />
        {enabled
          ? "Uploads are kept in your library, so you can reuse them in later runs."
          : "Your library isn't set up on this server, so uploads aren't kept for reuse."}
      </p>
    </div>
  );
}

// --------------------------------------------------
// ONE LIBRARY FILE
// --------------------------------------------------

function LibraryTile({
  index,
  file,
  kind,
  added,
  chosen,
  multiple,
  confirming,
  deleting,
  onToggle,
  onAddNow,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  index: number;
  file: LibraryFile;
  kind: FileKind;
  added: boolean;
  chosen: boolean;
  multiple: boolean;
  confirming: boolean;
  deleting: boolean;
  onToggle: () => void;
  onAddNow: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={cx("ui-rise group relative transition-opacity", deleting && "opacity-40")}
      style={{ "--i": index } as React.CSSProperties}
    >
      <button
        type="button"
        aria-pressed={multiple ? chosen : undefined}
        aria-label={`${file.name}${added ? " (added)" : ""}`}
        disabled={added || deleting}
        onClick={onToggle}
        onDoubleClick={() => multiple && !added && onAddNow()}
        className={cx(
          "block w-full overflow-hidden rounded-xl border text-left transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default",
          chosen
            ? "border-accent ring-2 ring-accent/40"
            : "border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg",
          added && "opacity-60"
        )}
      >
        {kind === "audio" ? (
          <span className="flex items-center gap-3 bg-sunken p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-fg-muted">
              <Icon name="play" size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-fg">{file.name}</span>
              <span className="block text-xs text-fg-subtle">{formatSize(file.size)}</span>
            </span>
          </span>
        ) : (
          <>
            <span className="relative block aspect-square overflow-hidden bg-black">
              {kind === "video" ? (
                <video
                  src={`${file.url}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              )}
              <MediaCaption src={file.url} kind={kind} className="pl-2" />
            </span>
            <span className="block truncate bg-surface px-2.5 py-2 text-xs text-fg-muted" title={file.name}>
              {file.name}
              <span className="text-fg-subtle"> · {formatSize(file.size)}</span>
            </span>
          </>
        )}

        {(added || chosen) && (
          <span className="ui-menu absolute left-2 top-2 flex h-6 items-center gap-1 rounded-full bg-accent px-2 text-xs font-medium text-on-accent shadow">
            <Icon name="check" size={12} />
            {added ? "Added" : "Selected"}
          </span>
        )}
      </button>

      {confirming ? (
        <div className="ui-backdrop absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/75 p-2 text-center backdrop-blur-sm">
          <span className="text-xs font-medium text-white">Delete from library?</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              autoFocus
              onClick={onDelete}
              className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-on-danger hover:opacity-90"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25"
            >
              Keep
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          aria-label={`Delete ${file.name}`}
          title="Delete from library"
          disabled={deleting}
          onClick={onAskDelete}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/65 text-white opacity-0 backdrop-blur transition-all hover:bg-danger focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-90"
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </li>
  );
}

function Skeletons({ kind }: { kind: FileKind }) {
  return (
    <ul aria-label="Loading your library" className={cx("grid gap-3", kind === "audio" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")}>
      {Array.from({ length: kind === "audio" ? 3 : 8 }, (_, index) => (
        <li key={index} className={cx("ui-skeleton rounded-xl", kind === "audio" ? "h-14" : "aspect-[4/5]")} />
      ))}
    </ul>
  );
}

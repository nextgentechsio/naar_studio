"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useFileDrop } from "@/app/components/ui/useFileDrop";
import { fetchHistoryPage } from "@/lib/client/data";
import { useElements } from "@/lib/client/elements";
import { errorMessage } from "@/lib/client/http";
import { getOutputType } from "@/lib/client/outputs";
import { LOOK_NAMES } from "@/lib/cuts/color";
import { deleteAsset } from "@/lib/cuts/client";
import type { PublicGeneration } from "@/lib/generations";
import { CutIcon } from "./CutIcon";
import { DRAG_TYPE, shortTime, useEditor, type DragPayload } from "./context";
import { LOOKS, SOLID_COLORS, TITLE_PRESETS, TRANSITIONS } from "./presets";
import { usePlaceAtPlayhead } from "./actions";

// --------------------------------------------------
// The media pool: everything that can go on the
// timeline. Outputs and elements are the main event:
// drag one onto a track (or press +) and it's copied
// into this cut and placed.
// --------------------------------------------------

type Tab = "outputs" | "elements" | "media" | "titles" | "transitions" | "looks";

const TABS: { id: Tab; label: string }[] = [
  { id: "outputs", label: "Outputs" },
  { id: "elements", label: "Elements" },
  { id: "media", label: "Media" },
  { id: "titles", label: "Titles" },
  { id: "transitions", label: "Transitions" },
  { id: "looks", label: "Looks" },
];

export function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "copy";
    },
  };
}

export default function MediaPool() {
  const [tab, setTab] = useState<Tab>("outputs");

  return (
    <aside className="nc-panel flex flex-col" aria-label="Media">
      <div className="nc-tabbar" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            data-active={tab === item.id}
            className="nc-tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="nc-scroll min-h-0 flex-1">
        {tab === "outputs" && <Outputs />}
        {tab === "elements" && <Elements />}
        {tab === "media" && <ProjectMedia />}
        {tab === "titles" && <Titles />}
        {tab === "transitions" && <Transitions />}
        {tab === "looks" && <Looks />}
      </div>
    </aside>
  );
}

function Preview({ url, kind }: { url: string; kind: "video" | "image" | "audio" }) {
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" />;
  }
  if (kind === "video") return <video src={`${url}#t=0.1`} preload="metadata" muted playsInline />;
  return (
    <div className="grid h-full place-items-center bg-[linear-gradient(135deg,rgb(49_196_141/0.25),transparent)]">
      <CutIcon name="audio" size={26} className="text-[#31c48d]" />
    </div>
  );
}

function Item({
  payload,
  url,
  kind,
  label,
  title,
  onAdd,
  extra,
}: {
  payload: DragPayload;
  url: string;
  kind: "video" | "image" | "audio";
  label: string;
  title: string;
  onAdd: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="nc-media-item" title={title} {...dragProps(payload)}>
      <Preview url={url} kind={kind} />
      <span className="nc-media-badge">{label}</span>
      <button className="nc-media-add" onClick={onAdd} aria-label={`Add ${title} at the playhead`}>
        <CutIcon name="plus" size={14} />
      </button>
      {extra}
    </div>
  );
}

const KIND_LABEL = { video: "Video", image: "Image", audio: "Audio" } as const;

// ---------- Outputs (History) ----------

function Outputs() {
  const place = usePlaceAtPlayhead();
  const [kind, setKind] = useState<"video" | "image" | "audio">("video");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PublicGeneration[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = useCallback(
    async (nextPage: number) => {
      const id = ++request.current;
      setLoading(true);
      setError("");
      try {
        const result = await fetchHistoryPage({ kind, q: search || undefined, page: nextPage, pageSize: 30, withOptions: false });
        if (id !== request.current) return;
        setItems((current) => (nextPage === 1 ? result.generations : [...current, ...result.generations]));
        setTotal(result.total);
        setPage(nextPage);
      } catch (err) {
        if (id === request.current) setError(errorMessage(err, "Couldn't load your outputs."));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [kind, search]
  );

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads when the filter changes
  useEffect(() => void load(1), [load]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <div className="flex flex-col gap-2 px-2 pb-2">
        <div className="flex gap-1">
          {(["video", "image", "audio"] as const).map((value) => (
            <button key={value} className="nc-chip" data-active={kind === value} onClick={() => setKind(value)}>
              {KIND_LABEL[value]}
            </button>
          ))}
        </div>
        <input
          className="nc-input"
          placeholder="Search prompts…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search outputs"
        />
      </div>

      {error && <p className="px-3 pb-2 text-xs text-danger">{error}</p>}

      <div className="nc-media-grid">
        {items.map((generation) => {
          const url = generation.outputUrl;
          if (!url || generation.outputExpired) return null;
          const itemKind = getOutputType(url, generation.outputContentType);
          if (itemKind !== "video" && itemKind !== "image" && itemKind !== "audio") return null;
          const payload: DragPayload = { type: "generation", id: generation.id, kind: itemKind, name: generation.prompt.slice(0, 80) };
          return (
            <Item
              key={generation.id}
              payload={payload}
              url={url}
              kind={itemKind}
              label={generation.model.split("/").pop() ?? KIND_LABEL[itemKind]}
              title={generation.prompt || generation.model}
              onAdd={() => place(payload)}
            />
          );
        })}
        {loading &&
          Array.from({ length: 6 }, (_, index) => <div key={`s${index}`} className="nc-media-item ui-skeleton animate-pulse" />)}
      </div>

      {!loading && !items.length && !error && (
        <p className="px-4 py-6 text-center text-xs text-fg-subtle">No {kind} outputs yet{search ? " for that search" : ""}.</p>
      )}
      {items.length < total && !loading && (
        <div className="px-2 pb-3">
          <button className="nc-chip w-full justify-center" onClick={() => void load(page + 1)}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Elements ----------

function Elements() {
  const place = usePlaceAtPlayhead();
  const { elements, error } = useElements();

  if (error) return <p className="px-3 py-2 text-xs text-danger">{error}</p>;
  if (!elements) {
    return (
      <div className="nc-media-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="nc-media-item animate-pulse" />
        ))}
      </div>
    );
  }
  if (!elements.length) {
    return <p className="px-4 py-6 text-center text-xs text-fg-subtle">No elements yet. Make some on the Elements page.</p>;
  }

  return (
    <div className="flex flex-col gap-3 pb-3">
      {elements.map((element) => {
        const files = [
          ...element.videos.map((url) => ({ url, kind: "video" as const })),
          ...element.images.map((url) => ({ url, kind: "image" as const })),
          ...element.audios.map((url) => ({ url, kind: "audio" as const })),
        ];
        return (
          <section key={element.id}>
            <h4 className="px-3 pb-1.5 text-xs font-semibold text-fg-muted">@{element.name}</h4>
            <div className="nc-media-grid">
              {files.map((file) => {
                const payload: DragPayload = { type: "element", url: file.url, kind: file.kind, name: `@${element.name}` };
                return (
                  <Item
                    key={file.url}
                    payload={payload}
                    url={file.url}
                    kind={file.kind}
                    label={KIND_LABEL[file.kind]}
                    title={`@${element.name}`}
                    onAdd={() => place(payload)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------- This cut's own files ----------

function ProjectMedia() {
  const { editor, cutId } = useEditor();
  const place = usePlaceAtPlayhead();
  const input = useRef<HTMLInputElement>(null);
  const { dragging, dropProps } = useFileDrop((files) => void editor.importFiles(files));
  const media = editor.assets.filter((asset) => asset.kind !== "export");
  const exports = editor.assets.filter((asset) => asset.kind === "export");

  const remove = async (assetId: string) => {
    if (editor.project.clips.some((clip) => clip.assetId === assetId)) {
      editor.setNotice("This file is on the timeline. Remove its clips first.");
      return;
    }
    try {
      await deleteAsset(cutId, assetId);
      editor.removeAssetLocal(assetId);
    } catch (error) {
      editor.setNotice(errorMessage(error, "Couldn't delete the file."));
    }
  };

  return (
    <div {...dropProps} className={dragging ? "rounded-xl outline outline-2 outline-[var(--nc-accent)]" : ""}>
      <div className="px-2 pb-2">
        <button className="nc-chip w-full justify-center" onClick={() => input.current?.click()}>
          <CutIcon name="upload" size={14} /> Upload or drop files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void editor.importFiles(files);
          }}
        />
      </div>

      <div className="nc-media-grid">
        {media.map((asset) => {
          const kind = asset.kind as "video" | "image" | "audio";
          const payload: DragPayload = { type: "asset", assetId: asset.id };
          return (
            <Item
              key={asset.id}
              payload={payload}
              url={asset.url}
              kind={kind}
              label={asset.durationMs ? shortTime((asset.durationMs / 1000) * 30, 30) : KIND_LABEL[kind]}
              title={asset.name}
              onAdd={() => place(payload)}
              extra={
                <button
                  className="nc-media-add"
                  style={{ right: 36 }}
                  onClick={() => void remove(asset.id)}
                  aria-label={`Delete ${asset.name}`}
                >
                  <CutIcon name="trash" size={13} />
                </button>
              }
            />
          );
        })}
      </div>
      {!media.length && <p className="px-4 py-4 text-center text-xs text-fg-subtle">Files you use in this cut appear here.</p>}

      {exports.length > 0 && (
        <section className="px-2 pb-3">
          <h4 className="px-1 pb-1.5 text-xs font-semibold text-fg-muted">Exports</h4>
          <ul className="flex flex-col gap-1">
            {exports.map((asset) => (
              <li key={asset.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-xs">
                <CutIcon name="film" size={14} className="text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                <a className="nc-icon-button" href={asset.url} download={asset.name} target="_blank" rel="noreferrer" aria-label={`Download ${asset.name}`}>
                  <CutIcon name="download" size={14} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- Titles, transitions and looks ----------

function Card({ payload, children, onClick, title }: { payload: DragPayload; children: ReactNode; onClick: () => void; title: string }) {
  return (
    <button className="nc-media-item text-left" title={title} onClick={onClick} {...dragProps(payload)}>
      {children}
    </button>
  );
}

function Titles() {
  const place = usePlaceAtPlayhead();
  return (
    <div className="flex flex-col gap-3 pb-3">
      <div className="nc-media-grid">
        {TITLE_PRESETS.map((preset) => (
          <Card key={preset.id} payload={{ type: "text", preset: preset.id }} onClick={() => place({ type: "text", preset: preset.id })} title={`Add “${preset.name}”`}>
            <div className="grid h-full place-items-center p-2" style={{ background: "radial-gradient(circle at 30% 20%, rgb(255 181 71 / 0.35), transparent 60%), #141418" }}>
              <span
                className="line-clamp-2 text-center text-white"
                style={{ fontWeight: preset.text.weight ?? 700, fontFamily: preset.text.font, fontSize: 13 }}
              >
                {preset.name}
              </span>
            </div>
          </Card>
        ))}
      </div>
      <section>
        <h4 className="px-3 pb-1.5 text-xs font-semibold text-fg-muted">Colour backgrounds</h4>
        <div className="nc-media-grid">
          {SOLID_COLORS.map((color) => (
            <Card key={color} payload={{ type: "solid", color }} onClick={() => place({ type: "solid", color })} title={`Add a ${color} background`}>
              <div className="h-full" style={{ background: color }} />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function Transitions() {
  const { editor, selection } = useEditor();
  const apply = (type: string) => {
    const targets = editor.project.clips.filter((clip) => selection.includes(clip.id) && clip.type !== "audio");
    if (!targets.length) {
      editor.setNotice("Select a clip, or drag a transition onto the start of one.");
      return;
    }
    editor.edit((project) => ({
      ...project,
      clips: project.clips.map((clip) =>
        targets.some((target) => target.id === clip.id)
          ? { ...clip, transition: { type: type as never, duration: clip.transition?.duration ?? Math.round(project.fps * 0.8) } }
          : clip
      ),
    }));
  };

  return (
    <div className="nc-media-grid">
      {TRANSITIONS.map((transition) => (
        <Card
          key={transition.type}
          payload={{ type: "transition", transition: transition.type }}
          onClick={() => apply(transition.type)}
          title={`${transition.name}: drag onto a clip, or click to apply to the selected clip`}
        >
          <div className="grid h-full place-items-center bg-[linear-gradient(90deg,rgb(91_140_255/0.35),rgb(167_123_255/0.35))]">
            <CutIcon name="layers" size={20} className="text-white/80" />
          </div>
          <span className="nc-media-badge">{transition.name}</span>
        </Card>
      ))}
    </div>
  );
}

function Looks() {
  const { editor, selection } = useEditor();
  const apply = (look: string) => {
    const targets = editor.project.clips.filter((clip) => selection.includes(clip.id) && (clip.type === "video" || clip.type === "image"));
    if (!targets.length) {
      editor.setNotice("Select a video or image clip, or drag a look onto one.");
      return;
    }
    editor.edit((project) => ({
      ...project,
      clips: project.clips.map((clip) =>
        targets.some((target) => target.id === clip.id) ? { ...clip, color: { ...clip.color, look: look as never, lookAmount: 1 } } : clip
      ),
    }));
  };

  return (
    <div className="nc-media-grid">
      {LOOKS.map((item) => (
        <Card key={item.look} payload={{ type: "look", look: item.look }} onClick={() => apply(item.look)} title={`${LOOK_NAMES[item.look]}: drag onto a clip, or click to apply`}>
          <div className="h-full" style={{ background: item.swatch }} />
          <span className="nc-media-badge">{LOOK_NAMES[item.look]}</span>
        </Card>
      ))}
    </div>
  );
}

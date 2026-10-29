"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import type { Player } from "@/lib/cuts/playback";
import { clipEnd, deleteClips, duplicateClips, newId, projectDuration, splitAt } from "@/lib/cuts/timeline";
import "../cuts.css";
import { CutIcon } from "./CutIcon";
import { EditorContext, FrameBus, isTyping, useEditor, type EditorContextValue, type Tool } from "./context";
import ExportDialog from "./ExportDialog";
import Inspector from "./Inspector";
import MediaPool from "./MediaPool";
import Timeline, { ZOOM_MAX, ZOOM_MIN } from "./Timeline";
import { useCutEditor, type SaveState } from "./useCutEditor";
import Viewer from "./Viewer";

// --------------------------------------------------
// NAAR CUTS: THE EDITOR
//
// A full-screen workspace over the studio (the studio's
// own layout is left as it is): media pool, preview and
// inspector on top, the timeline below.
// --------------------------------------------------

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved",
  conflict: "Changed elsewhere",
};

export default function Editor({ cutId }: { cutId: string }) {
  const { currentUser } = useStudio();
  const editor = useCutEditor(cutId, currentUser.id);
  const bus = useMemo(() => new FrameBus(), []);
  const [player, setPlayerState] = useState<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [snapping, setSnapping] = useState(true);
  const [zoom, setZoom] = useState(3);
  const [exportOpen, setExportOpen] = useState(false);
  const { project } = editor;

  // Clips removed by an edit (or undo) drop out
  const selection = useMemo(() => selected.filter((id) => project.clips.some((clip) => clip.id === id)), [selected, project.clips]);

  const setPlayer = useCallback(
    (next: Player | null) => {
      setPlayerState(next);
      if (next) {
        next.onFrame = (frame) => bus.set(frame);
        next.onPlayingChange = setPlaying;
        next.seek(bus.frame);
      }
    },
    [bus]
  );

  const seek = useCallback(
    (frame: number) => {
      if (player) player.seek(frame);
      else bus.set(Math.max(0, Math.round(frame)));
    },
    [player, bus]
  );

  // ---------- Keyboard ----------

  useEffect(() => {
    let rate = 1;
    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target) || exportOpen) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const frame = Math.floor(bus.frame);
      const fps = project.fps;
      const handled = () => event.preventDefault();

      if (command && key === "z") {
        handled();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (command && key === "y") {
        handled();
        editor.redo();
        return;
      }
      if (command && key === "s") {
        handled();
        void editor.flush();
        return;
      }
      if (command && key === "b") {
        handled();
        editor.edit((current) => splitAt(current, frame, selection.length ? selection : undefined));
        return;
      }
      if (command && key === "d") {
        handled();
        if (!selection.length) return;
        let created: string[] = [];
        editor.edit((current) => {
          const result = duplicateClips(current, selection);
          created = result.ids;
          return result.project;
        });
        setSelected(created);
        return;
      }
      if (command && key === "a") {
        handled();
        setSelected(project.clips.map((clip) => clip.id));
        return;
      }
      if (command) return;

      switch (event.key) {
        case " ":
          handled();
          player?.toggle();
          return;
        case "k":
        case "K":
          player?.pause();
          rate = 1;
          return;
        case "l":
        case "L":
          if (player?.isPlaying) rate = Math.min(4, rate * 2);
          else rate = 1;
          player?.play(rate);
          return;
        case "j":
        case "J":
          player?.pause();
          seek(frame - fps);
          return;
        case "ArrowLeft":
          handled();
          seek(frame - (event.shiftKey ? fps : 1));
          return;
        case "ArrowRight":
          handled();
          seek(frame + (event.shiftKey ? fps : 1));
          return;
        case "ArrowUp":
        case "ArrowDown": {
          handled();
          const edits = [...new Set(project.clips.flatMap((clip) => [clip.start, clipEnd(clip)]))].sort((a, b) => a - b);
          const target =
            event.key === "ArrowUp" ? [...edits].reverse().find((point) => point < frame) ?? 0 : edits.find((point) => point > frame);
          if (target !== undefined) seek(target);
          return;
        }
        case "Home":
          handled();
          seek(0);
          return;
        case "End":
          handled();
          seek(projectDuration(project));
          return;
        case "Backspace":
        case "Delete":
          handled();
          if (!selection.length) return;
          editor.edit((current) => deleteClips(current, selection, event.shiftKey));
          setSelected([]);
          return;
        case "Escape":
          setSelected([]);
          setTool("select");
          return;
        case "b":
        case "B":
          setTool("blade");
          return;
        case "a":
        case "A":
          setTool("select");
          return;
        case "s":
        case "S":
          setSnapping((on) => !on);
          return;
        case "m":
        case "M":
          editor.edit((current) => ({
            ...current,
            markers: [...current.markers, { id: newId("m"), frame, label: `Marker ${current.markers.length + 1}`, color: "#ffb547" }],
          }));
          return;
        case "+":
        case "=":
          setZoom((value) => Math.min(ZOOM_MAX, value * 1.4));
          return;
        case "-":
        case "_":
          setZoom((value) => Math.max(ZOOM_MIN, value / 1.4));
          return;
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [bus, editor, exportOpen, player, project, seek, selection]);

  // Notices fade after a while
  const { notice, setNotice } = editor;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  const value: EditorContextValue = {
    editor,
    cutId,
    userId: currentUser.id,
    bus,
    player,
    setPlayer,
    playing,
    seek,
    selection,
    select: setSelected,
    tool,
    setTool,
    snapping,
    setSnapping,
    zoom,
    setZoom,
    exportOpen,
    setExportOpen,
  };

  if (editor.loading || editor.loadError) {
    return (
      <div className="nc-workspace" style={{ display: "grid", placeItems: "center" }}>
        {editor.loadError ? (
          <div className="nc-panel max-w-sm p-6 text-center">
            <p className="mb-4 text-sm">{editor.loadError}</p>
            <Link href="/cuts" className="nc-chip inline-flex">
              Back to Naar Cuts
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-fg-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--nc-accent)]" />
            Opening your cut…
          </div>
        )}
      </div>
    );
  }

  return (
    <EditorContext.Provider value={value}>
      <div className="nc-workspace">
        <TopBar />
        <div className="nc-middle">
          <MediaPool />
          <Viewer />
          <Inspector />
        </div>
        <Timeline />
      </div>

      <div className="nc-busy" aria-live="polite">
        {editor.busy.map((job) => (
          <div key={job.id} className="nc-toast">
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--nc-accent)]" />
            <span className="min-w-0 flex-1 truncate">{job.label}</span>
            {job.progress !== null && <span className="nc-timecode text-fg-muted">{Math.round(job.progress)}%</span>}
          </div>
        ))}
        {notice && (
          <div className="nc-toast">
            <CutIcon name="info" size={14} className="text-[var(--nc-accent)]" />
            <span className="flex-1">{notice}</span>
            <button className="text-fg-subtle hover:text-fg" onClick={() => setNotice("")} aria-label="Dismiss">
              <CutIcon name="close" size={12} />
            </button>
          </div>
        )}
      </div>

      {exportOpen && <ExportDialog />}
    </EditorContext.Provider>
  );
}

function TopBar() {
  const { editor, setExportOpen } = useEditor();
  const { history, save } = editor;

  return (
    <header className="nc-panel flex items-center gap-2 px-3 py-2">
      <Link href="/cuts" className="nc-icon-button" title="All cuts" aria-label="Back to all cuts">
        <CutIcon name="arrowLeft" />
      </Link>
      <div className="flex items-center gap-2 pr-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[linear-gradient(135deg,#2fd6c8,#7c5cff)] text-white shadow-[0_6px_18px_-6px_rgb(47_214_200/0.7)]">
          <CutIcon name="scissors" size={15} />
        </span>
        <span className="hidden text-sm font-semibold sm:inline">Naar Cuts</span>
      </div>
      <input
        className="nc-input max-w-[280px] border-transparent bg-transparent text-sm font-medium hover:border-[var(--line)]"
        value={editor.name}
        maxLength={80}
        onChange={(event) => editor.setName(event.target.value)}
        aria-label="Cut name"
      />
      <span
        className="nc-chip"
        title={editor.saveError || undefined}
        style={{
          color: save === "error" || save === "conflict" ? "var(--danger)" : undefined,
          borderColor: save === "error" || save === "conflict" ? "var(--danger)" : undefined,
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: save === "saved" ? "#31c48d" : save === "saving" || save === "pending" ? "#ffb547" : "var(--danger)" }}
        />
        {SAVE_LABEL[save]}
      </span>
      {save === "conflict" && (
        <button className="nc-chip" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
      {save === "error" && (
        <button className="nc-chip" onClick={() => void editor.flush()}>
          Retry
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button className="nc-icon-button" disabled={!history.past.length} onClick={editor.undo} title="Undo (⌘Z)" aria-label="Undo">
          <CutIcon name="undo" />
        </button>
        <button className="nc-icon-button" disabled={!history.future.length} onClick={editor.redo} title="Redo (⇧⌘Z)" aria-label="Redo">
          <CutIcon name="redo" />
        </button>
        <button
          className="ml-2 flex h-9 items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2fd6c8,#7c5cff)] px-4 text-sm font-semibold text-white shadow-[0_10px_28px_-10px_rgb(124_92_255/0.8)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          onClick={() => setExportOpen(true)}
        >
          <CutIcon name="download" size={15} /> Export
        </button>
      </div>
    </header>
  );
}

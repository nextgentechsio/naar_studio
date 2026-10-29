"use client";

import { useEffect, useRef, useState } from "react";
import { uploadToLibrary } from "@/lib/client/library";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { uploadCutFile } from "@/lib/cuts/client";
import { EXPORT_HEIGHTS, canExport, exportProject, exportSize, type ExportProgress, type ExportSettings } from "@/lib/cuts/export";
import { projectDuration } from "@/lib/cuts/timeline";
import { CutIcon } from "./CutIcon";
import { shortTime, useEditor } from "./context";
import { FRAME_RATES } from "./presets";

// --------------------------------------------------
// Export: rendered in this tab, then kept with the cut
// (its exports/ folder) and offered as a download, or
// saved to the media library.
// --------------------------------------------------

type Phase =
  | { step: "settings" }
  | { step: "rendering"; progress: ExportProgress }
  | { step: "uploading"; percent: number | null }
  | { step: "done"; url: string; file: File; saved: boolean; library: "idle" | "saving" | "saved" | "error" }
  | { step: "error"; message: string };

const PHASE_LABEL: Record<ExportProgress["phase"], string> = {
  preparing: "Preparing",
  sound: "Mixing sound",
  frames: "Rendering frames",
  finishing: "Finishing the file",
};

export default function ExportDialog() {
  const { editor, cutId, userId, setExportOpen, player } = useEditor();
  const { project } = editor;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ExportSettings>({
    height: Math.min(2160, EXPORT_HEIGHTS.find((height) => height >= Math.min(project.width, project.height)) ?? 1080),
    fps: project.fps,
    quality: "high",
  });
  const [phase, setPhase] = useState<Phase>({ step: "settings" });
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const duration = projectDuration(project);

  useEffect(() => {
    let live = true;
    void canExport().then((value) => live && setSupported(value));
    return () => {
      live = false;
      abort.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const busy = phase.step === "rendering" || phase.step === "uploading";
  const close = () => {
    if (busy && !window.confirm("Stop the export?")) return;
    abort.current?.abort();
    setExportOpen(false);
  };

  const start = async () => {
    player?.pause();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ step: "rendering", progress: { phase: "preparing", done: 0, total: duration } });

    try {
      const blob = await exportProject(project, editor.playerAssets, settings, {
        signal: controller.signal,
        onProgress: (progress) => setPhase({ step: "rendering", progress }),
      });
      const safe = (editor.name || "cut").replace(/[^\w.-]+/g, "_").slice(0, 60);
      const file = new File([blob], `${safe}-${settings.height}p.mp4`, { type: blob.type || "video/mp4" });
      objectUrl.current = URL.createObjectURL(blob);

      // Kept with the cut
      setPhase({ step: "uploading", percent: null });
      let saved = false;
      try {
        const asset = await uploadCutFile(userId, cutId, file, "export", (percent) => setPhase({ step: "uploading", percent }));
        editor.upsertAsset(asset);
        saved = true;
      } catch (error) {
        logRequestError(error);
      }
      setPhase({ step: "done", url: objectUrl.current, file, saved, library: "idle" });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        setPhase({ step: "settings" });
        return;
      }
      logRequestError(error);
      setPhase({ step: "error", message: errorMessage(error, "The export failed.") });
    }
  };

  const saveToLibrary = async () => {
    if (phase.step !== "done") return;
    setPhase({ ...phase, library: "saving" });
    try {
      const url = await uploadToLibrary(phase.file);
      setPhase({ ...phase, library: url ? "saved" : "error" });
    } catch (error) {
      logRequestError(error);
      setPhase({ ...phase, library: "error" });
    }
  };

  const size = exportSize(project, settings.height);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Export">
      <div className="nc-panel w-full max-w-md p-5" style={{ animation: "nc-toast-in 260ms cubic-bezier(0.2,0.8,0.2,1)" }}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Export</h2>
            <p className="text-xs text-fg-subtle">
              {shortTime(duration, project.fps)} · MP4, rendered in this tab
            </p>
          </div>
          <button className="nc-icon-button" onClick={close} aria-label="Close">
            <CutIcon name="close" />
          </button>
        </div>

        {phase.step === "settings" && (
          <div className="flex flex-col gap-4">
            {supported === false && (
              <p className="rounded-lg border border-[var(--line-strong)] p-3 text-xs text-warning">
                This browser can&apos;t encode video. Use a recent Chrome, Edge or Safari to export.
              </p>
            )}
            <div>
              <p className="mb-1.5 text-xs text-fg-muted">Resolution</p>
              <div className="flex flex-wrap gap-1">
                {EXPORT_HEIGHTS.map((height) => (
                  <button key={height} className="nc-chip" data-active={settings.height === height} onClick={() => setSettings({ ...settings, height })}>
                    {height === 2160 ? "4K" : `${height}p`}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">
                {size.width}×{size.height}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-fg-muted">Frame rate</p>
              <div className="flex flex-wrap gap-1">
                {FRAME_RATES.map((fps) => (
                  <button key={fps} className="nc-chip" data-active={settings.fps === fps} onClick={() => setSettings({ ...settings, fps })}>
                    {fps}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-fg-muted">Quality</p>
              <div className="flex gap-1">
                {(["standard", "high"] as const).map((quality) => (
                  <button key={quality} className="nc-chip" data-active={settings.quality === quality} onClick={() => setSettings({ ...settings, quality })}>
                    {quality === "high" ? "High" : "Standard (smaller file)"}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="h-11 rounded-xl bg-[var(--fg)] text-sm font-semibold text-[var(--canvas)] transition-transform active:scale-[0.98] disabled:opacity-40"
              disabled={!supported || duration <= 0}
              onClick={() => void start()}
            >
              {duration <= 0 ? "The timeline is empty" : "Export video"}
            </button>
            <p className="text-[11px] text-fg-subtle">Keep this tab open while it renders. The result is saved with this cut.</p>
          </div>
        )}

        {phase.step === "rendering" && (
          <Progress
            label={PHASE_LABEL[phase.progress.phase]}
            value={phase.progress.phase === "frames" ? phase.progress.done / Math.max(1, phase.progress.total) : null}
            onCancel={() => abort.current?.abort()}
          />
        )}

        {phase.step === "uploading" && <Progress label="Saving the export with this cut" value={phase.percent === null ? null : phase.percent / 100} />}

        {phase.step === "done" && (
          <div className="flex flex-col gap-3">
            <video src={phase.url} controls className="w-full rounded-lg bg-black" />
            <p className="text-xs text-fg-muted">
              {phase.saved ? "Saved with this cut (Media → Exports)." : "Couldn't save it with the cut, but you can download it."}
            </p>
            <div className="flex gap-2">
              <a
                href={phase.url}
                download={phase.file.name}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--fg)] text-sm font-semibold text-[var(--canvas)]"
              >
                <CutIcon name="download" size={16} /> Download
              </a>
              <button
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--line-strong)] text-sm disabled:opacity-50"
                disabled={phase.library === "saving" || phase.library === "saved"}
                onClick={() => void saveToLibrary()}
              >
                {phase.library === "saved" ? "In your library" : phase.library === "saving" ? "Saving…" : phase.library === "error" ? "Try again" : "Save to library"}
              </button>
            </div>
            <button className="text-xs text-fg-subtle hover:text-fg" onClick={() => setPhase({ step: "settings" })}>
              Export again
            </button>
          </div>
        )}

        {phase.step === "error" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-danger">{phase.message}</p>
            <button className="nc-chip justify-center" onClick={() => setPhase({ step: "settings" })}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Progress({ label, value, onCancel }: { label: string; value: number | null; onCancel?: () => void }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-muted">{label}…</span>
        <span className="nc-timecode">{value === null ? "" : `${Math.round(value * 100)}%`}</span>
      </div>
      <div className="nc-progress">
        <span style={{ width: value === null ? "30%" : `${Math.max(2, value * 100)}%`, animation: value === null ? "ui-shimmer 1.2s linear infinite" : undefined }} />
      </div>
      {onCancel && (
        <button className="nc-chip self-start" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

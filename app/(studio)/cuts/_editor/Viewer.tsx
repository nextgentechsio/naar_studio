"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CutIcon } from "./CutIcon";
import { Player } from "@/lib/cuts/playback";
import { clipEnd, projectDuration } from "@/lib/cuts/timeline";
import { timecode, useEditor, usePlayhead } from "./context";

// --------------------------------------------------
// The program monitor: the preview, its transport and
// timecode, safe-area guides and audio meters.
// --------------------------------------------------

export default function Viewer() {
  const { editor, bus, player, setPlayer, playing, seek } = useEditor();
  const { project, playerAssets } = editor;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [safe, setSafe] = useState(false);
  const [loading, setLoading] = useState(false);
  const frame = usePlayhead(bus);
  const total = projectDuration(project);

  // One player for the editor's life
  useEffect(() => {
    if (!canvasRef.current) return;
    let created: Player | null = null;
    try {
      created = new Player(canvasRef.current, project);
      created.onLoadingChange = setLoading;
      created.onMediaError = () =>
        editor.setNotice("A file in this cut can't be played in this browser, so it's left out of the preview.");
      setPlayer(created);
    } catch (error) {
      editor.setNotice(error instanceof Error ? error.message : "The preview couldn't start.");
    }
    return () => {
      created?.dispose();
      setPlayer(null);
    };
    // Created once; the project and files are passed in below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    player?.setProject(project);
  }, [player, project]);

  useEffect(() => {
    player?.setAssets(playerAssets);
  }, [player, playerAssets]);

  // The largest frame of the project's shape that fits
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const width = stage.clientWidth - 28;
      const height = stage.clientHeight - 28;
      const ratio = project.width / project.height;
      const fitted = width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio };
      setBox({ width: Math.max(0, Math.floor(fitted.width)), height: Math.max(0, Math.floor(fitted.height)) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [project.width, project.height]);

  const edits = [...new Set(project.clips.flatMap((clip) => [clip.start, clipEnd(clip)]))].sort((a, b) => a - b);
  const previousEdit = () => seek([...edits].reverse().find((point) => point < Math.floor(frame)) ?? 0);
  const nextEdit = () => seek(edits.find((point) => point > Math.floor(frame)) ?? total);

  return (
    <section className="nc-panel flex flex-col" aria-label="Preview">
      <div ref={stageRef} className="nc-viewer-stage flex-1">
        <div className="nc-viewer-frame" style={{ width: box.width, height: box.height }}>
          <canvas ref={canvasRef} onDoubleClick={() => player?.toggle()} />
          {safe && <div className="nc-safe" />}
          {loading && project.clips.length > 0 && (
            <div className="nc-viewer-loading" role="status">
              <span>
                <span className="nc-spinner" aria-hidden />
                Loading video…
              </span>
            </div>
          )}
          {!project.clips.length && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/60">
              <div>
                <CutIcon name="film" size={28} className="mx-auto mb-2 opacity-60" />
                Drag outputs, elements or files onto the timeline to start.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="nc-timecode w-[104px] text-sm text-fg">{timecode(frame, project.fps)}</span>

        <div className="flex flex-1 items-center justify-center gap-1">
          <button className="nc-icon-button" onClick={() => seek(0)} title="Go to start (Home)" aria-label="Go to start">
            <CutIcon name="skipBack" size={16} />
          </button>
          <button className="nc-icon-button" onClick={previousEdit} title="Previous edit (↑)" aria-label="Previous edit">
            <CutIcon name="chevronLeft" size={16} />
          </button>
          <button
            className="nc-icon-button"
            onClick={() => player?.toggle()}
            title="Play / pause (Space)"
            aria-label={playing ? "Pause" : "Play"}
            style={{ height: 40, minWidth: 40, borderRadius: 14, background: "var(--fg)", color: "var(--canvas)" }}
          >
            <CutIcon name={playing ? "pause" : "play"} size={18} />
          </button>
          <button className="nc-icon-button" onClick={nextEdit} title="Next edit (↓)" aria-label="Next edit">
            <CutIcon name="chevronRight" size={16} />
          </button>
          <button className="nc-icon-button" onClick={() => seek(total)} title="Go to end (End)" aria-label="Go to end">
            <CutIcon name="skipForward" size={16} />
          </button>
        </div>

        <Meters />
        <button
          className="nc-icon-button"
          data-active={safe}
          onClick={() => setSafe((on) => !on)}
          title="Safe areas"
          aria-label="Safe areas"
        >
          <CutIcon name="frame" size={16} />
        </button>
        <span className="nc-timecode w-[104px] text-right text-sm text-fg-subtle">{timecode(total, project.fps)}</span>
      </div>
    </section>
  );
}

// Left and right peak levels while playing
function Meters() {
  const { player, playing } = useEditor();
  const leftRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!player || !playing) {
      if (leftRef.current) leftRef.current.style.height = "0%";
      if (rightRef.current) rightRef.current.style.height = "0%";
      return;
    }
    let raf = 0;
    const tick = () => {
      const [left, right] = player.levels();
      if (leftRef.current) leftRef.current.style.height = `${Math.round(left * 100)}%`;
      if (rightRef.current) rightRef.current.style.height = `${Math.round(right * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, playing]);

  return (
    <div className="nc-meter h-6" aria-hidden>
      <span ref={leftRef} style={{ height: "0%" }} />
      <span ref={rightRef} style={{ height: "0%" }} />
    </div>
  );
}

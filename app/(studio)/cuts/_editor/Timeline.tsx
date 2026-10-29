"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { thumbnail } from "@/lib/cuts/media";
import {
  KEYFRAME_PROPS,
  addTrack,
  clipEnd,
  deleteClips,
  moveClips,
  projectDuration,
  removeTrack,
  snap,
  snapMove,
  snapPoints,
  splitAt,
  splitClip,
  trimEnd,
  trimStart,
  updateTrack,
  type Clip,
  type Project,
  type Track,
} from "@/lib/cuts/timeline";
import type { CutAsset } from "@/lib/cuts/types";
import { CutIcon } from "./CutIcon";
import { DRAG_TYPE, shortTime, useEditor, type DragPayload } from "./context";
import { useApplyPayload } from "./actions";

// --------------------------------------------------
// The timeline: tracks, clips and the playhead. Moving
// and trimming follow the pointer frame by frame (with
// snapping to edges, the playhead and markers); a move
// lands when the pointer is let go, a trim updates live
// so the preview shows the new edge. Each gesture is one
// undo step.
// --------------------------------------------------

const TRACK_HEIGHT = 58;
const HEADER_WIDTH = 132;
const RULER_HEIGHT = 28;
// Pixels within which edges snap
const SNAP_PIXELS = 8;

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 40;

type Drag =
  | { kind: "move"; ids: string[]; anchor: string; x: number; y: number; frames: number; rows: number; moved: boolean; snapAt: number | null }
  | { kind: "trim"; id: string; side: "start" | "end"; x: number; origin: number; group: string; snapAt: number | null };

let gesture = 0;

export default function Timeline() {
  const { editor, bus, seek, selection, select, tool, setTool, snapping, setSnapping, zoom, setZoom, player } = useEditor();
  const { project } = editor;
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const apply = useApplyPayload();

  const duration = projectDuration(project);
  const contentFrames = Math.max(duration + project.fps * 20, project.fps * 60);
  const contentWidth = Math.ceil(contentFrames * zoom);

  // ---------- Playhead (outside React while playing) ----------

  useLayoutEffect(() => {
    const move = (frame: number) => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${frame * zoom}px)`;
      // Keep it in view while playing
      const scroller = scrollRef.current;
      if (scroller && player?.isPlaying) {
        const x = frame * zoom;
        const visible = scroller.clientWidth - HEADER_WIDTH;
        if (x > scroller.scrollLeft + visible - 60) scroller.scrollLeft = x - visible * 0.25;
      }
    };
    move(bus.frame);
    return bus.subscribe(move);
  }, [bus, zoom, player]);

  // What's in view, for the ruler's ticks
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => setView({ left: scroller.scrollLeft, width: scroller.clientWidth - HEADER_WIDTH });
    const first = requestAnimationFrame(update);
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(first);
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  // Zoom with ⌘/Ctrl + wheel, around the pointer
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const x = event.clientX - rect.left - HEADER_WIDTH + scroller.scrollLeft;
      const frame = x / zoom;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-event.deltaY * 0.0025)));
      setZoom(next);
      requestAnimationFrame(() => {
        scroller.scrollLeft = frame * next - (event.clientX - rect.left - HEADER_WIDTH);
      });
    };
    scroller.addEventListener("wheel", wheel, { passive: false });
    return () => scroller.removeEventListener("wheel", wheel);
  }, [zoom, setZoom]);

  // ---------- Coordinates ----------

  const frameAt = useCallback(
    (clientX: number) => {
      const scroller = scrollRef.current!;
      const rect = scroller.getBoundingClientRect();
      return Math.max(0, Math.round((clientX - rect.left - HEADER_WIDTH + scroller.scrollLeft) / zoom));
    },
    [zoom]
  );

  const threshold = SNAP_PIXELS / zoom;

  // ---------- Scrubbing ----------

  const scrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    player?.pause();
    const points = snapping ? snapPoints(project, -1) : [];
    const go = (clientX: number) => {
      const frame = frameAt(clientX);
      seek(snapping ? snap(frame, points, threshold).frame : frame);
    };
    go(event.clientX);
    const move = (moveEvent: PointerEvent) => go(moveEvent.clientX);
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  // ---------- Clip gestures ----------

  const onClipDown = (event: ReactPointerEvent, clip: Clip, side: "body" | "start" | "end") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const track = project.tracks.find((item) => item.id === clip.trackId);
    if (track?.locked) return;

    if (tool === "blade") {
      const frame = frameAt(event.clientX);
      const at = snapping ? snap(frame, [bus.frame], threshold).frame : frame;
      editor.edit((current) => splitClip(current, clip.id, at).project);
      return;
    }

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (side === "body") {
      const ids = event.shiftKey || event.metaKey
        ? selection.includes(clip.id)
          ? selection.filter((id) => id !== clip.id)
          : [...selection, clip.id]
        : selection.includes(clip.id)
          ? selection
          : [clip.id];
      select(ids);
      if (ids.includes(clip.id)) {
        setDrag({ kind: "move", ids, anchor: clip.id, x: event.clientX, y: event.clientY, frames: 0, rows: 0, moved: false, snapAt: null });
      }
    } else {
      select([clip.id]);
      setDrag({
        kind: "trim",
        id: clip.id,
        side,
        x: event.clientX,
        origin: side === "start" ? clip.start : clipEnd(clip),
        group: `trim-${++gesture}`,
        snapAt: null,
      });
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag) return;

    if (drag.kind === "move") {
      const anchor = project.clips.find((clip) => clip.id === drag.anchor);
      if (!anchor) return;
      let frames = Math.round((event.clientX - drag.x) / zoom);
      const rows = Math.round((event.clientY - drag.y) / TRACK_HEIGHT);
      let snapAt: number | null = null;
      if (snapping) {
        const points = snapPoints(project, bus.frame, new Set(drag.ids));
        const snapped = snapMove(anchor.start + frames, anchor.duration, points, threshold);
        frames = snapped.start - anchor.start;
        snapAt = snapped.snapped;
      }
      const moved = drag.moved || Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3;
      if (frames !== drag.frames || rows !== drag.rows || moved !== drag.moved || snapAt !== drag.snapAt) {
        setDrag({ ...drag, frames, rows, moved, snapAt });
      }
      return;
    }

    let frame = drag.origin + Math.round((event.clientX - drag.x) / zoom);
    let snapAt: number | null = null;
    if (snapping) {
      const snapped = snap(frame, snapPoints(project, bus.frame, new Set([drag.id])), threshold);
      frame = snapped.frame;
      snapAt = snapped.snapped ? snapped.frame : null;
    }
    const clip = project.clips.find((item) => item.id === drag.id);
    const info = editor.assetInfo(clip?.assetId ?? null);
    editor.edit(
      (current) => (drag.side === "start" ? trimStart(current, drag.id, frame) : trimEnd(current, drag.id, frame, info)),
      drag.group
    );
    if (snapAt !== drag.snapAt) setDrag({ ...drag, snapAt });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "move" && drag.moved && (drag.frames || drag.rows)) {
      editor.edit((current) => moveClips(current, drag.ids, drag.frames, drag.rows));
    }
    editor.seal();
    setDrag(null);
  };

  // ---------- Drops from the media pool ----------

  const canDrop = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    return types.includes(DRAG_TYPE) || types.includes("Files");
  };

  const onDrop = async (event: DragEvent, track: Track) => {
    if (!canDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTrack(null);
    const frame = frameAt(event.clientX);

    if (event.dataTransfer.files.length) {
      for (const [index, file] of Array.from(event.dataTransfer.files).entries()) {
        await editor.place({ type: "file", file }, frame + index, track.id);
      }
      return;
    }

    const payload = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "null") as DragPayload | null;
    if (!payload) return;
    // Transitions and looks go onto the clip under the pointer
    const under = project.clips.find((clip) => clip.trackId === track.id && frame >= clip.start && frame < clipEnd(clip));
    await apply(payload, frame, track.id, under?.id);
  };

  // ---------- Ruler ----------

  const ticks = useMemo(() => rulerTicks(project.fps, zoom, view.left, view.width), [project.fps, zoom, view]);

  const dragOffset = (clip: Clip) =>
    drag?.kind === "move" && drag.moved && drag.ids.includes(clip.id) ? { x: drag.frames * zoom, y: drag.rows * TRACK_HEIGHT } : null;

  const assets = editor.assetMap;
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  return (
    <section className={`nc-panel nc-timeline ${tool === "blade" ? "nc-blade" : ""}`} aria-label="Timeline">
      <Toolbar
        project={project}
        tool={tool}
        setTool={setTool}
        snapping={snapping}
        setSnapping={setSnapping}
        zoom={zoom}
        setZoom={setZoom}
        onSplit={() => editor.edit((current) => splitAt(current, Math.floor(bus.frame), selection.length ? selection : undefined))}
        onDelete={(ripple) => {
          editor.edit((current) => deleteClips(current, selection, ripple));
          select([]);
        }}
        hasSelection={selection.length > 0}
        onAddTrack={(kind) => editor.edit((current) => addTrack(current, kind))}
        onFit={() => {
          const width = (scrollRef.current?.clientWidth ?? 800) - HEADER_WIDTH - 40;
          setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, width / Math.max(project.fps * 5, duration))));
          if (scrollRef.current) scrollRef.current.scrollLeft = 0;
        }}
      />

      <div
        ref={scrollRef}
        className="nc-lanes min-h-0"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative" style={{ width: HEADER_WIDTH + contentWidth, minHeight: "100%" }}>
          {/* Ruler */}
          <div className="sticky top-0 z-[6] flex" style={{ height: RULER_HEIGHT }}>
            <div className="sticky left-0 z-[7] shrink-0 border-b border-r border-line bg-[var(--glass)] backdrop-blur-xl" style={{ width: HEADER_WIDTH }} />
            <div className="nc-ruler relative flex-1" onPointerDown={scrub}>
              {ticks.map((tick) => (
                <div key={tick.frame} style={{ position: "absolute", left: tick.frame * zoom, bottom: 0, height: tick.major ? 12 : 6 }} className="nc-ruler-tick" />
              ))}
              {ticks
                .filter((tick) => tick.major)
                .map((tick) => (
                  <span key={`l${tick.frame}`} className="nc-ruler-label" style={{ left: tick.frame * zoom }}>
                    {shortTime(tick.frame, project.fps)}
                  </span>
                ))}
              {project.markers.map((marker) => (
                <span key={marker.id} className="nc-marker" style={{ left: marker.frame * zoom, background: marker.color }} title={marker.label} />
              ))}
            </div>
          </div>

          {/* Tracks */}
          {project.tracks.map((track) => (
            <div key={track.id} className="flex">
              <TrackHeader
                track={track}
                project={project}
                onChange={(patch) => editor.edit((current) => updateTrack(current, track.id, patch))}
                onRemove={() => editor.edit((current) => removeTrack(current, track.id))}
              />
              <div
                className="nc-lane flex-1"
                data-drop={dropTrack === track.id}
                data-locked={track.locked}
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.target !== event.currentTarget) return;
                  select([]);
                  scrub(event);
                }}
                onDragOver={(event) => {
                  if (!canDrop(event) || track.locked) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  if (dropTrack !== track.id) setDropTrack(track.id);
                }}
                onDragLeave={() => setDropTrack((current) => (current === track.id ? null : current))}
                onDrop={(event) => void onDrop(event, track)}
              >
                {project.clips
                  .filter((clip) => clip.trackId === track.id)
                  .map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      fps={project.fps}
                      zoom={zoom}
                      asset={clip.assetId ? assets.get(clip.assetId) : undefined}
                      selected={selectedSet.has(clip.id)}
                      offset={dragOffset(clip)}
                      dimmed={track.hidden || (track.kind === "audio" && track.muted)}
                      onDown={onClipDown}
                    />
                  ))}
              </div>
            </div>
          ))}

          {/* Playhead and snap guide */}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: HEADER_WIDTH, right: 0 }}>
            <div ref={playheadRef} className="nc-playhead" />
            {drag?.snapAt != null && <div className="nc-snapline" style={{ left: drag.snapAt * zoom }} />}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Toolbar ----------

function Toolbar(props: {
  project: Project;
  tool: "select" | "blade";
  setTool: (tool: "select" | "blade") => void;
  snapping: boolean;
  setSnapping: (on: boolean) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  onSplit: () => void;
  onDelete: (ripple: boolean) => void;
  hasSelection: boolean;
  onAddTrack: (kind: "video" | "audio") => void;
  onFit: () => void;
}) {
  const slider = Math.log(props.zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);

  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
      <button className="nc-icon-button" data-active={props.tool === "select"} onClick={() => props.setTool("select")} title="Select (A)" aria-label="Select tool">
        <CutIcon name="cursor" />
      </button>
      <button className="nc-icon-button" data-active={props.tool === "blade"} onClick={() => props.setTool("blade")} title="Blade (B)" aria-label="Blade tool">
        <CutIcon name="scissors" />
      </button>
      <span className="mx-1 h-5 w-px bg-[var(--line-strong)]" />
      <button className="nc-icon-button" onClick={props.onSplit} title="Split at playhead (⌘B)" aria-label="Split at playhead">
        <CutIcon name="split" />
      </button>
      <button className="nc-icon-button" disabled={!props.hasSelection} onClick={() => props.onDelete(false)} title="Delete (⌫)" aria-label="Delete">
        <CutIcon name="trash" />
      </button>
      <button
        className="nc-icon-button text-xs font-semibold"
        disabled={!props.hasSelection}
        onClick={() => props.onDelete(true)}
        title="Ripple delete (⇧⌫): later clips close the gap"
        aria-label="Ripple delete"
      >
        Ripple
      </button>
      <span className="mx-1 h-5 w-px bg-[var(--line-strong)]" />
      <button className="nc-icon-button" data-active={props.snapping} onClick={() => props.setSnapping(!props.snapping)} title="Snapping (S)" aria-label="Snapping">
        <CutIcon name="magnet" />
      </button>
      <button className="nc-icon-button text-xs font-semibold" onClick={() => props.onAddTrack("video")} title="Add a video track">
        + V
      </button>
      <button className="nc-icon-button text-xs font-semibold" onClick={() => props.onAddTrack("audio")} title="Add an audio track">
        + A
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button className="nc-icon-button" onClick={() => props.setZoom(Math.max(ZOOM_MIN, props.zoom / 1.4))} title="Zoom out (−)" aria-label="Zoom out">
          <CutIcon name="zoomOut" />
        </button>
        <input
          className="nc-range w-28"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={slider}
          style={{ ["--fill" as string]: `${slider * 100}%` }}
          onChange={(event) => props.setZoom(ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Number(event.target.value)))}
          aria-label="Timeline zoom"
        />
        <button className="nc-icon-button" onClick={() => props.setZoom(Math.min(ZOOM_MAX, props.zoom * 1.4))} title="Zoom in (+)" aria-label="Zoom in">
          <CutIcon name="zoomIn" />
        </button>
        <button className="nc-icon-button text-xs font-semibold" onClick={props.onFit} title="Fit the timeline (⇧Z)">
          Fit
        </button>
      </div>
    </div>
  );
}

// ---------- Track header ----------

function TrackHeader({
  track,
  project,
  onChange,
  onRemove,
}: {
  track: Track;
  project: Project;
  onChange: (patch: Partial<Track>) => void;
  onRemove: () => void;
}) {
  const last = project.tracks.filter((item) => item.kind === track.kind).length <= 1;
  return (
    <div
      className="nc-track-header group sticky left-0 z-[4] shrink-0 border-r border-line bg-[var(--glass)] backdrop-blur-xl"
      style={{ width: HEADER_WIDTH, height: TRACK_HEIGHT }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: track.kind === "video" ? "var(--nc-video)" : "var(--nc-audio)" }}>
          {track.name}
        </span>
        {!last && (
          <button className="opacity-0 transition-opacity group-hover:opacity-100" onClick={onRemove} title="Remove track and its clips" aria-label={`Remove ${track.name}`}>
            <CutIcon name="close" size={12} />
          </button>
        )}
      </div>
      <div className="flex gap-1">
        {track.kind === "video" ? (
          <button data-warn={track.hidden} onClick={() => onChange({ hidden: !track.hidden })} title={track.hidden ? "Show track" : "Hide track"} aria-label="Toggle visibility">
            <CutIcon name={track.hidden ? "eyeOff" : "eye"} size={12} />
          </button>
        ) : (
          <>
            <button data-warn={track.muted} onClick={() => onChange({ muted: !track.muted })} title="Mute" aria-label="Mute">
              M
            </button>
            <button data-on={track.solo} onClick={() => onChange({ solo: !track.solo })} title="Solo" aria-label="Solo">
              S
            </button>
          </>
        )}
        <button data-on={track.locked} onClick={() => onChange({ locked: !track.locked })} title={track.locked ? "Unlock" : "Lock"} aria-label="Lock">
          <CutIcon name={track.locked ? "lock" : "unlock"} size={12} />
        </button>
      </div>
    </div>
  );
}

// ---------- Clips ----------

const ClipView = memo(function ClipView({
  clip,
  fps,
  zoom,
  asset,
  selected,
  offset,
  dimmed,
  onDown,
}: {
  clip: Clip;
  fps: number;
  zoom: number;
  asset: CutAsset | undefined;
  selected: boolean;
  offset: { x: number; y: number } | null;
  dimmed: boolean;
  onDown: (event: ReactPointerEvent, clip: Clip, side: "body" | "start" | "end") => void;
}) {
  const left = clip.start * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const label =
    clip.type === "text"
      ? (clip.text?.text ?? "Title").split("\n")[0]
      : clip.name || asset?.name || clip.type;
  const keyframes = selected
    ? [...new Set(KEYFRAME_PROPS.flatMap((prop) => clip.keyframes[prop]?.map((key) => key.frame) ?? []))]
    : [];

  return (
    <div
      className="nc-clip"
      data-kind={clip.type}
      data-selected={selected}
      data-dragging={Boolean(offset)}
      style={{
        left,
        width,
        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        opacity: dimmed ? 0.45 : undefined,
      }}
      onPointerDown={(event) => onDown(event, clip, "body")}
      title={`${label} · ${shortTime(clip.duration, fps)}`}
    >
      {clip.type === "video" && asset && <Filmstrip url={asset.url} clip={clip} fps={fps} zoom={zoom} width={width} aspect={(asset.width ?? 16) / (asset.height ?? 9)} />}
      {clip.type === "image" && asset && (
        <div className="nc-clip-film" style={{ backgroundImage: `url(${asset.url})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />
      )}
      {clip.type === "solid" && <div className="nc-clip-film" style={{ background: clip.fill ?? "#000", opacity: 0.8 }} />}
      {(clip.type === "audio" || (clip.type === "video" && !clip.audioMuted)) && asset?.peaks && (
        <Waveform peaks={asset.peaks} durationMs={asset.durationMs} clip={clip} fps={fps} width={width} compact={clip.type === "video"} />
      )}

      <span className="nc-clip-label">
        {clip.transition && "◆ "}
        {label}
        {clip.speed !== 1 && ` · ${clip.speed}×`}
      </span>

      {clip.fadeIn > 0 && <div className="nc-fade" style={{ left: 0, width: clip.fadeIn * zoom, ["--dir" as string]: "90deg" }} />}
      {clip.fadeOut > 0 && <div className="nc-fade" style={{ right: 0, width: clip.fadeOut * zoom, ["--dir" as string]: "270deg" }} />}
      {clip.transition && (
        <div className="nc-transition-mark" style={{ left: 0, width: Math.max(10, clip.transition.duration * zoom) }} />
      )}
      {keyframes.map((frame) => (
        <span key={frame} className="nc-keyframe-dot" style={{ left: frame * zoom }} />
      ))}

      <div className="nc-handle" data-side="start" onPointerDown={(event) => onDown(event, clip, "start")} />
      <div className="nc-handle" data-side="end" onPointerDown={(event) => onDown(event, clip, "end")} />
    </div>
  );
});

// Pictures along a video clip, from the stretch of the
// file it shows
function Filmstrip({ url, clip, fps, zoom, width, aspect }: { url: string; clip: Clip; fps: number; zoom: number; width: number; aspect: number }) {
  const thumbWidth = Math.max(24, (TRACK_HEIGHT - 8) * aspect);
  const count = Math.min(60, Math.max(1, Math.ceil(width / thumbWidth)));
  const secondsPerThumb = (thumbWidth / zoom / fps) * clip.speed;
  const step = secondsPerThumb > 4 ? Math.round(secondsPerThumb) : secondsPerThumb > 1 ? 1 : 0.5;

  return (
    <div className="nc-clip-film">
      {Array.from({ length: count }, (_, index) => (
        <Thumb key={index} url={url} seconds={clip.offset + index * secondsPerThumb} step={step} width={thumbWidth} />
      ))}
    </div>
  );
}

function Thumb({ url, seconds, step, width }: { url: string; seconds: number; step: number; width: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void thumbnail(url, seconds, step).then((result) => {
      if (live) setSrc(result);
    });
    return () => {
      live = false;
    };
  }, [url, seconds, step]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" style={{ width }} /> : <span style={{ width, flex: "0 0 auto" }} />;
}

// The clip's stretch of the file's waveform
function Waveform({
  peaks,
  durationMs,
  clip,
  fps,
  width,
  compact,
}: {
  peaks: number[];
  durationMs: number | null;
  clip: Clip;
  fps: number;
  width: number;
  compact: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !durationMs) return;
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.min(4000, Math.ceil(width));
    const height = compact ? 18 : TRACK_HEIGHT - 10;
    canvas.width = pixels * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext("2d")!;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, pixels, height);
    context.fillStyle = compact ? "rgba(255,255,255,0.55)" : "rgba(220,255,240,0.85)";

    const perSecond = peaks.length / (durationMs / 1000);
    const from = clip.offset * perSecond;
    const span = (clip.duration / fps) * clip.speed * perSecond;
    for (let x = 0; x < pixels; x++) {
      const index = Math.floor(from + (x / pixels) * span);
      const value = (peaks[index] ?? 0) / 255;
      const bar = Math.max(1, value * height * clip.volume);
      context.fillRect(x, compact ? height - bar : (height - bar) / 2, 1, bar);
    }
  }, [peaks, durationMs, clip.offset, clip.duration, clip.speed, clip.volume, fps, width, compact]);

  return (
    <canvas
      ref={ref}
      className="nc-clip-wave"
      style={compact ? { top: "auto", bottom: 0, height: 18 } : { top: 5, height: TRACK_HEIGHT - 10 }}
    />
  );
}

// Ruler ticks for what's in view, spaced to stay legible
function rulerTicks(fps: number, zoom: number, left: number, width: number) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map((seconds) => seconds * fps);
  const frameSteps = [1, 2, 5, 10].filter((value) => value < fps);
  const all = [...frameSteps, ...steps];
  const major = all.find((step) => step * zoom >= 90) ?? all[all.length - 1];
  const minor = all.filter((step) => step < major && major % step === 0 && step * zoom >= 12).pop() ?? major;

  const first = Math.max(0, Math.floor(left / zoom / minor) * minor);
  const last = Math.ceil((left + width) / zoom);
  const ticks: { frame: number; major: boolean }[] = [];
  for (let frame = first; frame <= last && ticks.length < 600; frame += minor) {
    ticks.push({ frame, major: frame % major === 0 });
  }
  return ticks;
}

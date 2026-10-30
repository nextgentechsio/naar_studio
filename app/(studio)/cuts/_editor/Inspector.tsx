"use client";

import { useRef, useState, type ReactNode } from "react";
import { LOOK_NAMES } from "@/lib/cuts/color";
import { baseValue, removeKey, setKey, valueAt } from "@/lib/cuts/keyframes";
import {
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  detachAudio,
  setSpeed,
  updateClip,
  withFrameRate,
  type Clip,
  type Color,
  type ColorLook,
  type KeyframeProp,
  type Project,
  type TextStyle,
  type Transform,
  type TransitionType,
} from "@/lib/cuts/timeline";
import { CutIcon } from "./CutIcon";
import { shortTime, useEditor, usePlayhead } from "./context";
import { ASPECTS, FRAME_RATES, TRANSITIONS } from "./presets";

// --------------------------------------------------
// The inspector: settings of the selected clip, or of
// the project when nothing is selected. Moving a slider
// is one undo step. Keyframed settings change at the
// playhead.
// --------------------------------------------------

let gestureCounter = 0;

const FONTS = [
  { name: "Inter", value: "Inter, system-ui, sans-serif" },
  { name: "Studio", value: "var(--font-lufga), system-ui, sans-serif" },
  { name: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { name: "Mono", value: "ui-monospace, Menlo, monospace" },
  { name: "Impact", value: "Impact, 'Arial Black', sans-serif" },
  { name: "Rounded", value: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
];

export default function Inspector() {
  const { editor, selection } = useEditor();
  const clips = editor.project.clips.filter((clip) => selection.includes(clip.id));

  return (
    <aside className="nc-panel nc-inspector flex flex-col" aria-label="Inspector">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <CutIcon name="wand" className="text-fg-subtle" />
        <h2 className="text-sm font-semibold">{clips.length === 1 ? "Clip" : clips.length > 1 ? `${clips.length} clips` : "Project"}</h2>
      </div>
      <div className="nc-scroll min-h-0 flex-1 px-4 pb-6">
        {clips.length === 1 ? <ClipInspector key={clips[0].id} clip={clips[0]} /> : clips.length > 1 ? <Many count={clips.length} /> : <ProjectInspector />}
      </div>
    </aside>
  );
}

// ---------- Building blocks ----------

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-line py-3 last:border-b-0">
      <div className="mb-1 flex items-center justify-between">
        <button className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted" onClick={() => setOpen(!open)}>
          <CutIcon name="chevronDown" size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  );
}

function useGesture() {
  const { editor } = useEditor();
  const group = useRef<string | null>(null);
  return {
    group: () => group.current,
    start: () => {
      group.current = `slider-${++gestureCounter}`;
    },
    end: () => {
      group.current = null;
      editor.seal();
    },
  };
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (number: number) => number.toFixed(2),
  onChange,
  keyframe,
  reset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number, group: string | null) => void;
  keyframe?: { active: boolean; on: boolean; toggle: () => void };
  // Double-click puts it back to this
  reset?: number;
}) {
  const gesture = useGesture();
  const fill = ((value - min) / (max - min)) * 100;

  return (
    <label className="grid grid-cols-[84px_1fr_48px_18px] items-center gap-2 text-xs">
      <span className="truncate text-fg-muted">{label}</span>
      <input
        className="nc-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${Math.min(100, Math.max(0, fill))}%` }}
        onPointerDown={gesture.start}
        onPointerUp={gesture.end}
        onChange={(event) => onChange(Number(event.target.value), gesture.group())}
        onDoubleClick={() => reset !== undefined && onChange(reset, null)}
      />
      <span className="nc-timecode text-right text-fg">{format(value)}</span>
      {keyframe ? (
        <button
          onClick={(event) => {
            event.preventDefault();
            keyframe.toggle();
          }}
          className={keyframe.on ? "text-[var(--nc-accent)]" : keyframe.active ? "text-fg" : "text-fg-subtle hover:text-fg"}
          title={keyframe.on ? "Remove the keyframe here" : "Add a keyframe here"}
          aria-label={`Keyframe ${label}`}
        >
          <CutIcon name="diamond" size={11} />
        </button>
      ) : (
        <span />
      )}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2 text-xs">
      <span className="text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const degrees = (value: number) => `${Math.round(value)}°`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

// ---------- One clip ----------

function ClipInspector({ clip }: { clip: Clip }) {
  const { editor, bus } = useEditor();
  const frame = usePlayhead(bus);
  const fps = editor.project.fps;
  const local = Math.min(clip.duration, Math.max(0, Math.round(frame) - clip.start));
  const visual = clip.type !== "audio";
  const timed = clip.type === "video" || clip.type === "audio";
  const audible = clip.type === "audio" || (clip.type === "video" && !clip.audioMuted);

  const patch = (change: Partial<Clip>, group: string | null = null) =>
    editor.edit((project) => updateClip(project, clip.id, change), group);

  // A keyframable setting: at the playhead when keyed
  const keyed = (prop: KeyframeProp, label: string, min: number, max: number, format: (value: number) => string, step = 0.01) => {
    const keys = clip.keyframes[prop];
    const value = valueAt(keys, local, baseValue(clip, prop));
    const on = Boolean(keys?.some((key) => key.frame === local));
    return (
      <Slider
        key={prop}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        format={format}
        reset={prop === "volume" ? 1 : DEFAULT_TRANSFORM[prop]}
        onChange={(next, group) =>
          editor.edit((project) => {
            const current = project.clips.find((item) => item.id === clip.id)!;
            const list = current.keyframes[prop];
            if (list?.length) return updateClip(project, clip.id, { keyframes: { ...current.keyframes, [prop]: setKey(list, local, next) } });
            return prop === "volume"
              ? updateClip(project, clip.id, { volume: next })
              : updateClip(project, clip.id, { transform: { ...current.transform, [prop]: next } });
          }, group)
        }
        keyframe={{
          active: Boolean(keys?.length),
          on,
          toggle: () =>
            patch({
              keyframes: {
                ...clip.keyframes,
                [prop]: on ? removeKey(keys, local) : setKey(keys, local, value),
              },
            }),
        }}
      />
    );
  };

  const setTransform = (change: Partial<Transform>, group: string | null) => patch({ transform: { ...clip.transform, ...change } }, group);
  const setColor = (change: Partial<Color>, group: string | null) => patch({ color: { ...clip.color, ...change } }, group);
  const setText = (change: Partial<TextStyle>, group: string | null = null) => patch({ text: { ...clip.text!, ...change } }, group);

  return (
    <div>
      <div className="py-3">
        <input
          className="nc-input font-semibold"
          value={clip.name}
          placeholder={clip.type === "text" ? "Title" : "Clip name"}
          onChange={(event) => patch({ name: event.target.value }, `name-${clip.id}`)}
          onBlur={() => editor.seal()}
          aria-label="Clip name"
        />
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          {clip.type} · {shortTime(clip.duration, fps)} · starts {shortTime(clip.start, fps)}
        </p>
      </div>

      {clip.type === "text" && clip.text && (
        <Section title="Text">
          <textarea
            className="nc-input min-h-[64px] py-1.5"
            value={clip.text.text}
            onChange={(event) => setText({ text: event.target.value }, `text-${clip.id}`)}
            onBlur={() => editor.seal()}
            aria-label="Title text"
          />
          <Row label="Font">
            <select className="nc-input" value={clip.text.font} onChange={(event) => setText({ font: event.target.value })}>
              {FONTS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.name}
                </option>
              ))}
            </select>
          </Row>
          <Slider label="Size" value={clip.text.size} min={0.02} max={0.3} step={0.005} format={percent} onChange={(value, group) => setText({ size: value }, group)} />
          <Slider label="Weight" value={clip.text.weight} min={300} max={900} step={100} format={(value) => String(value)} onChange={(value, group) => setText({ weight: value }, group)} />
          <Row label="Colour">
            <div className="flex items-center gap-2">
              <input type="color" value={clip.text.color} onChange={(event) => setText({ color: event.target.value }, `color-${clip.id}`)} className="h-7 w-10 rounded" />
              <div className="flex gap-1">
                {(["left", "center", "right"] as const).map((align) => (
                  <button key={align} className="nc-chip" data-active={clip.text!.align === align} onClick={() => setText({ align })}>
                    {align[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </Row>
          <Slider label="Outline" value={clip.text.stroke} min={0} max={0.2} step={0.005} format={percent} onChange={(value, group) => setText({ stroke: value }, group)} />
          <Row label="Outline colour">
            <input type="color" value={clip.text.strokeColor} onChange={(event) => setText({ strokeColor: event.target.value }, `stroke-${clip.id}`)} className="h-7 w-10 rounded" />
          </Row>
          <Row label="Style">
            <div className="flex flex-wrap gap-1">
              <button className="nc-chip" data-active={clip.text.shadow} onClick={() => setText({ shadow: !clip.text!.shadow })}>
                Shadow
              </button>
              <button className="nc-chip" data-active={Boolean(clip.text.background)} onClick={() => setText({ background: clip.text!.background ? "" : "rgba(0,0,0,0.55)" })}>
                Box
              </button>
            </div>
          </Row>
          <Row label="Animation">
            <select className="nc-input" value={clip.text.animation} onChange={(event) => setText({ animation: event.target.value as TextStyle["animation"] })}>
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="rise">Rise</option>
              <option value="pop">Pop</option>
              <option value="typewriter">Typewriter</option>
            </select>
          </Row>
        </Section>
      )}

      {clip.type === "solid" && (
        <Section title="Colour">
          <Row label="Fill">
            <input type="color" value={clip.fill ?? "#000000"} onChange={(event) => patch({ fill: event.target.value }, `fill-${clip.id}`)} className="h-7 w-10 rounded" />
          </Row>
        </Section>
      )}

      {visual && (
        <Section
          title="Transform"
          action={
            <button className="text-[11px] text-fg-subtle hover:text-fg" onClick={() => patch({ transform: { ...DEFAULT_TRANSFORM }, keyframes: { volume: clip.keyframes.volume } })}>
              Reset
            </button>
          }
        >
          {keyed("x", "Position X", -1, 1, signed)}
          {keyed("y", "Position Y", -1, 1, signed)}
          {keyed("scale", "Scale", 0.1, 4, percent)}
          {keyed("rotation", "Rotation", -180, 180, degrees, 1)}
          {keyed("opacity", "Opacity", 0, 1, percent)}
          {(clip.type === "video" || clip.type === "image") && (
            <>
              <Slider label="Crop left" value={clip.transform.cropLeft} reset={0} min={0} max={0.45} format={percent} onChange={(value, group) => setTransform({ cropLeft: value }, group)} />
              <Slider label="Crop right" value={clip.transform.cropRight} reset={0} min={0} max={0.45} format={percent} onChange={(value, group) => setTransform({ cropRight: value }, group)} />
              <Slider label="Crop top" value={clip.transform.cropTop} reset={0} min={0} max={0.45} format={percent} onChange={(value, group) => setTransform({ cropTop: value }, group)} />
              <Slider label="Crop bottom" value={clip.transform.cropBottom} reset={0} min={0} max={0.45} format={percent} onChange={(value, group) => setTransform({ cropBottom: value }, group)} />
            </>
          )}
        </Section>
      )}

      {(clip.type === "video" || clip.type === "image") && (
        <Section
          title="Colour"
          action={
            <button className="text-[11px] text-fg-subtle hover:text-fg" onClick={() => patch({ color: { ...DEFAULT_COLOR } })}>
              Reset
            </button>
          }
        >
          <Row label="Look">
            <select className="nc-input" value={clip.color.look} onChange={(event) => setColor({ look: event.target.value as ColorLook }, null)}>
              {Object.entries(LOOK_NAMES).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </Row>
          {clip.color.look !== "none" && (
            <Slider label="Look amount" value={clip.color.lookAmount} reset={DEFAULT_COLOR.lookAmount} min={0} max={1} format={percent} onChange={(value, group) => setColor({ lookAmount: value }, group)} />
          )}
          <Slider label="Exposure" value={clip.color.exposure} reset={DEFAULT_COLOR.exposure} min={-3} max={3} format={signed} onChange={(value, group) => setColor({ exposure: value }, group)} />
          <Slider label="Contrast" value={clip.color.contrast} reset={DEFAULT_COLOR.contrast} min={-1} max={1} format={signed} onChange={(value, group) => setColor({ contrast: value }, group)} />
          <Slider label="Saturation" value={clip.color.saturation} reset={DEFAULT_COLOR.saturation} min={0} max={2} format={percent} onChange={(value, group) => setColor({ saturation: value }, group)} />
          <Slider label="Temperature" value={clip.color.temperature} reset={DEFAULT_COLOR.temperature} min={-1} max={1} format={signed} onChange={(value, group) => setColor({ temperature: value }, group)} />
          <Slider label="Tint" value={clip.color.tint} reset={DEFAULT_COLOR.tint} min={-1} max={1} format={signed} onChange={(value, group) => setColor({ tint: value }, group)} />
          <Slider label="Highlights" value={clip.color.highlights} reset={DEFAULT_COLOR.highlights} min={-1} max={1} format={signed} onChange={(value, group) => setColor({ highlights: value }, group)} />
          <Slider label="Shadows" value={clip.color.shadows} reset={DEFAULT_COLOR.shadows} min={-1} max={1} format={signed} onChange={(value, group) => setColor({ shadows: value }, group)} />
          <Slider label="Vignette" value={clip.color.vignette} reset={DEFAULT_COLOR.vignette} min={0} max={1} format={percent} onChange={(value, group) => setColor({ vignette: value }, group)} />
        </Section>
      )}

      {timed && (
        <Section title="Speed">
          <Slider
            label="Speed"
            value={clip.speed}
            reset={1}
            min={0.25}
            max={4}
            step={0.05}
            format={(value) => `${value.toFixed(2)}×`}
            onChange={(value, group) => editor.edit((project) => setSpeed(project, clip.id, value, editor.assetInfo(clip.assetId)), group)}
          />
          <div className="flex flex-wrap gap-1 pl-[92px]">
            {[0.5, 1, 1.5, 2].map((speed) => (
              <button
                key={speed}
                className="nc-chip"
                data-active={clip.speed === speed}
                onClick={() => editor.edit((project) => setSpeed(project, clip.id, speed, editor.assetInfo(clip.assetId)))}
              >
                {speed}×
              </button>
            ))}
          </div>
        </Section>
      )}

      {(audible || visual) && (
        <Section title={audible ? "Sound and fades" : "Fades"}>
          {audible && keyed("volume", "Volume", 0, 2, percent)}
          <Slider
            label="Fade in"
            value={clip.fadeIn / fps}
            min={0}
            max={Math.min(10, clip.duration / fps)}
            step={1 / fps}
            format={(value) => `${value.toFixed(1)}s`}
            onChange={(value, group) => patch({ fadeIn: Math.round(value * fps) }, group)}
          />
          <Slider
            label="Fade out"
            value={clip.fadeOut / fps}
            min={0}
            max={Math.min(10, clip.duration / fps)}
            step={1 / fps}
            format={(value) => `${value.toFixed(1)}s`}
            onChange={(value, group) => patch({ fadeOut: Math.round(value * fps) }, group)}
          />
          {clip.type === "video" && !clip.audioMuted && (
            <div className="flex gap-1 pl-[92px]">
              <button className="nc-chip" onClick={() => editor.edit((project) => detachAudio(project, clip.id).project)}>
                <CutIcon name="detach" size={12} /> Detach audio
              </button>
              <button className="nc-chip" onClick={() => patch({ audioMuted: true })}>
                <CutIcon name="mute" size={12} /> Mute
              </button>
            </div>
          )}
          {clip.type === "video" && clip.audioMuted && (
            <div className="pl-[92px]">
              <button className="nc-chip" onClick={() => patch({ audioMuted: false })}>
                <CutIcon name="volume" size={12} /> Unmute clip sound
              </button>
            </div>
          )}
        </Section>
      )}

      {visual && (
        <Section
          title="Transition in"
          action={
            clip.transition ? (
              <button className="text-[11px] text-fg-subtle hover:text-fg" onClick={() => patch({ transition: null })}>
                Remove
              </button>
            ) : undefined
          }
        >
          <Row label="Type">
            <select
              className="nc-input"
              value={clip.transition?.type ?? ""}
              onChange={(event) =>
                patch({
                  transition: event.target.value
                    ? { type: event.target.value as TransitionType, duration: clip.transition?.duration ?? Math.round(fps * 0.8) }
                    : null,
                })
              }
            >
              <option value="">None</option>
              {TRANSITIONS.map((transition) => (
                <option key={transition.type} value={transition.type}>
                  {transition.name}
                </option>
              ))}
            </select>
          </Row>
          {clip.transition && (
            <Slider
              label="Duration"
              value={clip.transition.duration / fps}
              min={1 / fps}
              max={Math.min(4, clip.duration / fps)}
              step={1 / fps}
              format={(value) => `${value.toFixed(2)}s`}
              onChange={(value, group) => patch({ transition: { ...clip.transition!, duration: Math.max(1, Math.round(value * fps)) } }, group)}
            />
          )}
          <p className="text-[11px] text-fg-subtle">
            Centred on the cut from the clip before it on this track; with nothing before it, the clip fades in from what&apos;s below.
          </p>
        </Section>
      )}
    </div>
  );
}

function Many({ count }: { count: number }) {
  return (
    <p className="py-4 text-xs text-fg-muted">
      {count} clips selected. Drag to move them together, press ⌫ to delete, ⌘D to duplicate, or drag a look or transition onto one.
    </p>
  );
}

// ---------- The project ----------

function ProjectInspector() {
  const { editor } = useEditor();
  const { project } = editor;
  // Same shape, at any size (an older 4K project too)
  const aspect = ASPECTS.find((item) => Math.abs(item.width / item.height - project.width / project.height) < 0.01);

  const set = (change: (project: Project) => Project) => editor.edit(change);

  return (
    <div>
      <Section title="Format">
        <div className="space-y-2">
          <div className="nc-aspects" role="radiogroup" aria-label="Frame shape">
            {ASPECTS.map((item) => {
              // The shape, fitted in a 26px box
              const scale = 26 / Math.max(item.width, item.height);
              return (
                <button
                  key={item.name}
                  role="radio"
                  aria-checked={item === aspect}
                  aria-label={`${item.name}, ${item.use}`}
                  title={item.use}
                  className="nc-aspect"
                  onClick={() => {
                    if (item !== aspect) set((current) => ({ ...current, width: item.width, height: item.height }));
                  }}
                >
                  <span className="nc-aspect-shape" style={{ width: item.width * scale, height: item.height * scale }} />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-fg-muted">
            {aspect ? `${aspect.use} · ` : "Custom · "}
            {project.width}×{project.height}. Pick the resolution when you export.
          </p>
        </div>
        <Row label="Frame rate">
          <div className="nc-segmented" role="radiogroup" aria-label="Frame rate">
            {FRAME_RATES.map((fps) => (
              <button
                key={fps}
                role="radio"
                aria-checked={project.fps === fps}
                title={`${fps} frames per second`}
                onClick={() => {
                  if (project.fps !== fps) set((current) => withFrameRate(current, fps));
                }}
              >
                {fps}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Background">
          <input type="color" value={project.background} onChange={(event) => set((current) => ({ ...current, background: event.target.value }))} className="h-7 w-10 rounded" />
        </Row>
      </Section>

      <Section title="Shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-fg-muted">
          {[
            ["Space / K", "Play / pause"],
            ["L", "Play faster (1×, 2×, 4×)"],
            ["J", "Back one second"],
            ["← →", "One frame (⇧: one second)"],
            ["↑ ↓", "Previous / next edit"],
            ["B / A", "Blade / select tool"],
            ["⌘B", "Split at playhead"],
            ["⌫ / ⇧⌫", "Delete / ripple delete"],
            ["⌘D", "Duplicate"],
            ["⌘Z / ⇧⌘Z", "Undo / redo"],
            ["S", "Snapping"],
            ["M", "Add marker"],
            ["+ / −", "Zoom"],
            ["⌘S", "Save now"],
          ].map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt className="nc-timecode text-fg">{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

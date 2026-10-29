"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Player } from "@/lib/cuts/playback";
import type { CutEditor } from "./useCutEditor";

// --------------------------------------------------
// NAAR CUTS: SHARED EDITOR STATE
//
// The playhead moves every frame while playing, so it
// lives outside React: parts that follow it closely (the
// timeline's playhead line) subscribe and move the DOM
// themselves; text like the timecode re-renders at most
// once per animation frame.
// --------------------------------------------------

export class FrameBus {
  frame = 0;
  private listeners = new Set<(frame: number) => void>();

  set(frame: number) {
    this.frame = frame;
    for (const listener of this.listeners) listener(frame);
  }

  subscribe(listener: (frame: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export type Tool = "select" | "blade";

export type EditorContextValue = {
  editor: CutEditor;
  cutId: string;
  userId: string;
  bus: FrameBus;
  player: Player | null;
  setPlayer: (player: Player | null) => void;
  playing: boolean;
  seek: (frame: number) => void;
  selection: string[];
  select: (ids: string[]) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  snapping: boolean;
  setSnapping: (on: boolean) => void;
  // Timeline zoom: pixels per frame
  zoom: number;
  setZoom: (zoom: number) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("useEditor must be used inside the Naar Cuts editor");
  return value;
}

// The playhead frame, re-rendering at most once a frame
export function usePlayhead(bus: FrameBus): number {
  const [frame, setFrame] = useState(bus.frame);

  useEffect(() => {
    let raf = 0;
    const unsubscribe = bus.subscribe((next) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFrame(next));
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [bus]);

  return frame;
}

// "00:01:23:12" (hours:minutes:seconds:frames)
export function timecode(frame: number, fps: number) {
  const whole = Math.max(0, Math.floor(frame));
  const frames = whole % fps;
  const seconds = Math.floor(whole / fps);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frames)}`;
}

// "1:05" or "12.4s" for short spans
export function shortTime(frame: number, fps: number) {
  const seconds = frame / fps;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// Data carried by drags from the media pool
export const DRAG_TYPE = "application/x-naar-cuts";

export type DragPayload =
  | { type: "generation"; id: string; kind: "video" | "image" | "audio"; name: string }
  | { type: "element"; url: string; kind: "video" | "image" | "audio"; name: string }
  | { type: "asset"; assetId: string }
  | { type: "text"; preset: string }
  | { type: "solid"; color: string }
  | { type: "transition"; transition: string }
  | { type: "look"; look: string };

// Typing in a field: shortcuts stay out of the way
export function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

"use client";

import { useCallback } from "react";
import {
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  freeTrack,
  insertClip,
  newClip,
  type ColorLook,
  type Project,
  type TransitionType,
} from "@/lib/cuts/timeline";
import { useEditor, type DragPayload } from "./context";
import { TITLE_PRESETS } from "./presets";

// --------------------------------------------------
// Putting things from the media pool on the timeline:
// by dropping them on a track, or with + (at the
// playhead, on the first fitting track).
// --------------------------------------------------

// The highest unlocked video track with nothing in
// [from, to) (titles go over pictures)
function topFreeVideoTrack(project: Project, from: number, to: number) {
  return (
    project.tracks.find(
      (track) =>
        track.kind === "video" &&
        !track.locked &&
        !project.clips.some((clip) => clip.trackId === track.id && clip.start < to && clip.start + clip.duration > from)
    )?.id ?? null
  );
}

export function useApplyPayload() {
  const { editor, select } = useEditor();

  return useCallback(
    async (payload: DragPayload, frame: number, trackId?: string, clipId?: string) => {
      const project = editor.project;

      switch (payload.type) {
        case "generation":
        case "element":
        case "asset": {
          const id = await editor.place(payload, frame, trackId);
          if (id) select([id]);
          return;
        }

        case "text":
        case "solid": {
          const preset = payload.type === "text" ? TITLE_PRESETS.find((item) => item.id === payload.preset) : undefined;
          const clip = newClip({
            trackId: "",
            type: payload.type,
            start: Math.max(0, Math.round(frame)),
            duration: Math.round((preset?.seconds ?? 5) * project.fps),
            name: preset?.name ?? "Colour",
            ...(payload.type === "text"
              ? {
                  text: { ...DEFAULT_TEXT, ...preset?.text },
                  transform: { ...DEFAULT_TRANSFORM, ...preset?.transform },
                }
              : { fill: payload.color }),
          });
          // Dropped on a track: there. Otherwise titles go on
          // the top free video track, backgrounds the lowest.
          editor.edit((current) => {
            const dropped = current.tracks.find((track) => track.id === trackId && track.kind === "video" && !track.locked);
            if (dropped) return insertClip(current, { ...clip, trackId: dropped.id });
            const end = clip.start + clip.duration;
            const top = payload.type === "text" ? topFreeVideoTrack(current, clip.start, end) : null;
            const target = top ? { project: current, trackId: top } : freeTrack(current, "video", clip.start, end);
            return insertClip(target.project, { ...clip, trackId: target.trackId });
          });
          select([clip.id]);
          return;
        }

        case "transition":
        case "look": {
          const clip = project.clips.find((item) => item.id === clipId);
          if (!clip || clip.type === "audio") {
            editor.setNotice(`Drop ${payload.type === "look" ? "a look" : "a transition"} onto a video, image or title clip.`);
            return;
          }
          if (payload.type === "look" && clip.type !== "video" && clip.type !== "image") {
            editor.setNotice("Looks apply to video and image clips.");
            return;
          }
          editor.edit((current) => ({
            ...current,
            clips: current.clips.map((item) =>
              item.id !== clip.id
                ? item
                : payload.type === "look"
                  ? { ...item, color: { ...item.color, look: payload.look as ColorLook, lookAmount: 1 } }
                  : {
                      ...item,
                      transition: {
                        type: payload.transition as TransitionType,
                        duration: item.transition?.duration ?? Math.round(current.fps * 0.8),
                      },
                    }
            ),
          }));
          select([clip.id]);
          return;
        }
      }
    },
    [editor, select]
  );
}

// + in the media pool: at the playhead
export function usePlaceAtPlayhead() {
  const { bus, selection } = useEditor();
  const apply = useApplyPayload();
  return useCallback(
    (payload: DragPayload) => void apply(payload, Math.floor(bus.frame), undefined, selection[0]),
    [apply, bus, selection]
  );
}

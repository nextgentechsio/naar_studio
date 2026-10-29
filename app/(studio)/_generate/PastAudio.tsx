"use client";

import { useEffect, useRef, useState } from "react";
import { useGenerate } from "@/app/(studio)/_generate/GenerateProvider";
import { Icon } from "@/app/components/ui/Icon";
import { Button, cx } from "@/app/components/ui/primitives";
import { fetchGeneration, fetchHistoryPage, type PublicGeneration } from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import { findElevenLabsModel, type ElevenLabsTool } from "@/lib/elevenlabs/models";

// --------------------------------------------------
// PAST RESULTS TO LISTEN TO (ElevenLabs music and sound
// effects)
//
// These models have no samples, so the form lists what
// was already made with the same tool (any version),
// newest first, each with a play button. "Reuse" fills
// the form with that run's prompt and settings, as
// History's "Run again" does. One clip plays at a time.
// --------------------------------------------------

// Runs looked through, and clips shown
const LOOKED_AT = 60;
const SHOWN = 20;

const NOUNS: Partial<Record<ElevenLabsTool, string>> = { music: "music", sound: "sound effects" };

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export default function PastAudio({ tool }: { tool: ElevenLabsTool }) {
  const { project, loadDraft, finishedAt, setError } = useGenerate();
  const audio = useRef<HTMLAudioElement>(null);

  const [runs, setRuns] = useState<{ tool: string; list: PublicGeneration[] } | null>(null);
  const [playing, setPlaying] = useState<{ id: string; loaded: boolean } | null>(null);
  const [reusing, setReusing] = useState("");

  // Reloaded for another tool, and after each run
  useEffect(() => {
    let cancelled = false;

    fetchHistoryPage({ provider: "elevenlabs", kind: "audio", status: "succeeded", pageSize: LOOKED_AT, withOptions: false })
      .then((page) => {
        if (cancelled) return;
        const list = page.generations
          .filter((run) => run.model.startsWith(`${tool}/`) && run.outputUrl && !run.outputExpired)
          .slice(0, SHOWN);
        setRuns({ tool, list });
      })
      .catch(() => {
        if (!cancelled) setRuns({ tool, list: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [tool, finishedAt]);

  const list = runs?.tool === tool ? runs.list : null;
  const noun = NOUNS[tool] ?? "audio";

  function listen(run: PublicGeneration) {
    const node = audio.current;
    if (!node || !run.outputUrl) return;

    if (playing?.id === run.id) {
      node.pause();
      setPlaying(null);
      return;
    }

    node.src = run.outputUrl;
    node.currentTime = 0;
    setPlaying({ id: run.id, loaded: false });
    node.play().catch(() => setPlaying(null));
  }

  async function reuse(run: PublicGeneration) {
    setReusing(run.id);
    try {
      const detail = await fetchGeneration(run.id);
      audio.current?.pause();
      setPlaying(null);
      // Keep the project already chosen
      loadDraft({ project: project || detail.project, model: detail.model, inputs: detail.inputs });
    } catch (err) {
      setError(errorMessage(err, "Couldn't load that run."));
    } finally {
      setReusing("");
    }
  }

  // Nothing made yet: nothing to show
  if (!list?.length) return null;

  return (
    <details
      open
      className="group ui-rise shrink-0 rounded-lg border border-line"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          audio.current?.pause();
          setPlaying(null);
        }
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-sm font-medium text-fg-muted hover:text-fg">
        <span>
          Past {noun}
          <span className="ml-1.5 text-fg-subtle">({list.length})</span>
        </span>
        <Icon name="chevronDown" size={16} className="transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <ul className="max-h-56 space-y-0.5 overflow-y-auto border-t border-line p-1.5" aria-label={`Past ${noun}`}>
        {list.map((run) => {
          const isPlaying = playing?.id === run.id;
          const version = findElevenLabsModel(run.model)?.task;

          return (
            <li
              key={run.id}
              className={cx(
                "flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-1.5 transition-colors hover:bg-raised",
                isPlaying && "bg-raised"
              )}
            >
              <button
                type="button"
                onClick={() => listen(run)}
                aria-label={`${isPlaying ? "Stop" : "Listen to"} “${run.prompt || "untitled"}”`}
                aria-pressed={isPlaying}
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                  isPlaying
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-sunken text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                <Icon name={isPlaying ? "pause" : "play"} size={12} className={cx(isPlaying && !playing.loaded && "animate-pulse")} />
              </button>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg" title={run.prompt}>
                  {run.prompt || "Untitled"}
                </span>
                <span className="block truncate text-xs text-fg-subtle">
                  {[version, day.format(new Date(run.createdAt))].filter(Boolean).join(" · ")}
                </span>
              </span>

              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={reusing !== ""}
                onClick={() => reuse(run)}
                title="Use this prompt and its settings"
              >
                {reusing === run.id ? "Loading…" : "Reuse"}
              </Button>
            </li>
          );
        })}
      </ul>

      <audio
        ref={audio}
        preload="none"
        onPlaying={() => setPlaying((now) => (now ? { ...now, loaded: true } : now))}
        onEnded={() => setPlaying(null)}
        onError={() => setPlaying(null)}
      />
    </details>
  );
}

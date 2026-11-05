"use client";

import { useEffect, useState } from "react";
import type { ShotRun } from "@/lib/catalogue/shared";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import styles from "./generating.module.css";

// --------------------------------------------------
// THE "GENERATING" ANIMATION, wherever a catalogue image
// is being made: the big preview (full), shot tiles
// (compact) and version thumbnails (tiny).
//
// Waiting in the call queue (startedAt null) shows as
// "Waiting in queue"; then phases of the shoot cycle with
// the time so far, and a bar that eases toward (never to)
// the end over a typical run.
// --------------------------------------------------

const PHASES_INITIAL = ["Reading the garment", "Matching the model", "Setting up the studio", "Dressing the look", "Lighting the shot", "Finishing details"];
const PHASES_SHOT = ["Matching the initial look", "Framing the shot", "Posing the model", "Lighting the shot", "Finishing details"];
// A typical image (the pace of the bar and the phases,
// spread over it; the last phase holds after)
const TYPICAL_MS = 45_000;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function Generating({
  run,
  size = "full",
  initial = false,
  overlay = false,
  className,
}: {
  run: Pick<ShotRun, "createdAt" | "startedAt"> | null;
  size?: "full" | "compact" | "tiny";
  initial?: boolean;
  // Over the previous image (a regenerate): see-through
  overlay?: boolean;
  className?: string;
}) {
  const now = useNow(size !== "tiny");
  // Without a run (a product card): timed from when shown
  const [shownAt] = useState(() => Date.now());
  const queued = run ? run.startedAt === null : false;
  const since = run ? Date.parse(run.startedAt ?? run.createdAt) : shownAt;
  const elapsed = Math.max(0, now - since);
  const phases = initial ? PHASES_INITIAL : PHASES_SHOT;
  const phaseMs = TYPICAL_MS / phases.length;
  const phase = queued ? "Waiting in queue" : phases[Math.min(phases.length - 1, Math.floor(elapsed / phaseMs))];
  // Eases toward 92%: fast at first, slower near the end
  const progress = Math.round(92 * (1 - Math.exp(-elapsed / (TYPICAL_MS / 2.2))));

  return (
    <div
      role="status"
      aria-label={queued ? "Waiting in queue" : "Generating"}
      className={cx(
        styles.root,
        size === "compact" && styles.compact,
        size === "tiny" && cx(styles.compact, styles.tiny),
        overlay && styles.overlay,
        className,
      )}
    >
      <span aria-hidden className={styles.aurora} />
      <span aria-hidden className={styles.grid} />
      <span aria-hidden className={styles.scan} />
      <div className={styles.center}>
        <span aria-hidden className={styles.mark}>
          <Icon name={queued ? "clock" : "shirt"} size={size === "full" ? 24 : size === "compact" ? 16 : 12} />
        </span>
        {size !== "tiny" && (
          <>
            <span className={styles.label} aria-live="polite">
              <span key={phase} className={styles.phase}>
                {phase}…
              </span>
            </span>
            {size === "full" && (
              <span className={cx(styles.bar, queued && styles.waiting)} aria-hidden>
                <span style={{ width: `${progress}%` }} />
              </span>
            )}
            <span className={styles.meta}>
              {queued ? (size === "full" ? "Starts as soon as a slot frees up" : null) : clock(elapsed)}
              {size === "full" && !queued && <span aria-hidden>·</span>}
              {size === "full" && !queued && <span>Usually under a minute</span>}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

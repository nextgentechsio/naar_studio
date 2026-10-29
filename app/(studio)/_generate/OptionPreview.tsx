"use client";

import { useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx, Spinner } from "@/app/components/ui/primitives";

// --------------------------------------------------
// LISTEN TO THE CHOSEN OPTION
//
// A play / pause button beside a dropdown whose options
// have samples (ElevenLabs voices: each voice's preview
// clip). Keyed by the option, so choosing another one
// removes the old sample, which stops it.
// --------------------------------------------------

export default function OptionPreview({ src, name }: { src: string | undefined; name: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");

  function toggle() {
    const node = audio.current;
    if (!node || !src) return;

    if (state !== "idle") {
      node.pause();
      node.currentTime = 0;
      setState("idle");
      return;
    }

    setState("loading");
    node.currentTime = 0;
    node.play().catch(() => setState("idle"));
  }

  const label = src ? (state === "idle" ? `Listen to ${name}` : `Stop ${name}`) : `No sample for ${name}`;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={label}
        aria-pressed={state !== "idle"}
        title={label}
        className={cx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          state === "idle"
            ? "border-line bg-sunken text-fg-muted hover:border-line-strong hover:text-fg"
            : "border-accent bg-accent-soft text-accent"
        )}
      >
        {state === "loading" ? <Spinner /> : <Icon name={state === "playing" ? "pause" : "play"} size={14} />}
      </button>

      {src && (
        <audio
          ref={audio}
          src={src}
          preload="none"
          onPlaying={() => setState("playing")}
          onPause={() => setState("idle")}
          onEnded={() => setState("idle")}
          onError={() => setState("idle")}
        />
      )}
    </>
  );
}

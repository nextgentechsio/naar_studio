"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx, inputClass } from "@/app/components/ui/primitives";

// --------------------------------------------------
// A DROPDOWN YOU CAN LISTEN TO
//
// For options with samples (ElevenLabs voices): the list
// shows every option with its own play button, so voices
// can be compared before one is chosen. One sample plays
// at a time; closing the list stops it. Typing filters
// the list; ↑↓ move, ↵ chooses, space plays.
// --------------------------------------------------

// A search box once the list is this long
const SEARCH_FROM = 8;

type Props = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  options: string[];
  // "Rachel · female, american"
  labels?: Record<string, string>;
  previews: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
};

// "Rachel · female, american" → name and details
function split(label: string) {
  const [name, ...rest] = label.split(" · ");
  return { name, details: rest.join(" · ") };
}

export default function SamplePicker({ options, labels = {}, previews, value, onChange, ...control }: Props) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The option whose sample is loading or playing
  const [playing, setPlaying] = useState<{ option: string; loaded: boolean } | null>(null);

  const label = (option: string) => labels[option] ?? option;
  const lower = query.trim().toLowerCase();
  const shown = lower ? options.filter((option) => label(option).toLowerCase().includes(lower)) : options;
  const current = split(label(value));

  function stop() {
    audio.current?.pause();
    setPlaying(null);
  }

  function listen(option: string) {
    const node = audio.current;
    const src = previews[option];
    if (!node || !src) return;

    if (playing?.option === option) return stop();

    node.src = src;
    node.currentTime = 0;
    setPlaying({ option, loaded: false });
    node.play().catch(() => setPlaying(null));
  }

  function show() {
    setQuery("");
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }

  function close(focus = true) {
    stop();
    setOpen(false);
    if (focus) trigger.current?.focus();
  }

  function choose(option: string) {
    onChange(option);
    close();
  }

  // Focus the search (or list) and show the chosen option
  useEffect(() => {
    if (!open) return;
    (search.current ?? list.current)?.focus();
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Keep the active option in view while moving
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // A click outside closes it
  useEffect(() => {
    if (!open) return;

    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        audio.current?.pause();
        setPlaying(null);
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // Only the list closes, not a dialog around it
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + shown.length) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === " " && event.target === list.current) {
      event.preventDefault();
      if (shown[active]) listen(shown[active]);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        {...control}
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            show();
          }
        }}
        className={cx(inputClass, "flex items-center gap-2 text-left")}
      >
        <span className="min-w-0 flex-1 truncate">
          {current.name}
          {current.details && <span className="text-fg-subtle"> · {current.details}</span>}
        </span>
        <Icon name="chevronDown" size={14} className="shrink-0 text-fg-subtle" />
      </button>

      {open && (
        <div
          className="ui-menu glass-menu absolute left-0 top-full z-30 mt-1.5 w-[max(100%,18rem)] overflow-hidden rounded-xl border"
          onKeyDown={onKeyDown}
        >
          {options.length >= SEARCH_FROM && (
            <div className="border-b border-line p-1.5">
              <input
                ref={search}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Search voices…"
                aria-label="Search voices"
                aria-controls={listId}
                aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                className="h-8 w-full rounded-md bg-sunken px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}

          <ul
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Voices"
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            className="max-h-72 overflow-y-auto p-1.5 outline-none"
          >
            {shown.map((option, index) => {
              const { name, details } = split(label(option));
              const isPlaying = playing?.option === option;

              return (
                <li
                  key={option}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option === value}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cx(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors",
                    index === active && "bg-raised"
                  )}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={!previews[option]}
                    aria-label={previews[option] ? `${isPlaying ? "Stop" : "Listen to"} ${name}` : `No sample for ${name}`}
                    title={previews[option] ? undefined : "No sample for this voice"}
                    onClick={(event) => {
                      // Listening doesn't choose it
                      event.stopPropagation();
                      listen(option);
                    }}
                    className={cx(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                      isPlaying
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-sunken text-fg-muted hover:border-line-strong hover:text-fg"
                    )}
                  >
                    <Icon name={isPlaying ? "pause" : "play"} size={12} className={cx(isPlaying && !playing.loaded && "animate-pulse")} />
                  </button>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{name}</span>
                    {details && <span className="block truncate text-xs text-fg-subtle">{details}</span>}
                  </span>

                  {option === value && <Icon name="check" size={14} className="shrink-0 text-accent" />}
                </li>
              );
            })}

            {!shown.length && <li className="px-2 py-3 text-xs text-fg-subtle">No voice matches “{query}”.</li>}
          </ul>

          <p className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">
            <span>↑↓ move</span>
            <span>↵ choose</span>
            <span>▶ listen</span>
          </p>
        </div>
      )}

      <audio
        ref={audio}
        preload="none"
        onPlaying={() => setPlaying((now) => (now ? { ...now, loaded: true } : now))}
        onEnded={() => setPlaying(null)}
        onError={() => setPlaying(null)}
      />
    </div>
  );
}

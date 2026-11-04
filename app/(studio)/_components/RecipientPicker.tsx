"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/components/ui/Icon";
import { cx, inputClass } from "@/app/components/ui/primitives";
import { ROLE_LABELS, type PublicUser } from "@/lib/auth/roles";
import { errorMessage, fetchJson } from "@/lib/client/http";
import { MAX_RECIPIENTS } from "@/lib/notifications-shared";

// --------------------------------------------------
// WHO GETS A NOTIFICATION (super admin's send form)
//
// Everyone, or chosen users: a search box with a dropdown
// of matching users (name or username); chosen ones show
// as chips. Disabled accounts and the sender aren't
// offered. Users load once, when "Specific users" is
// first picked.
// --------------------------------------------------

export type Audience = { everyone: true } | { everyone: false; users: PublicUser[] };

export default function RecipientPicker({
  value,
  onChange,
  selfId,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
  selfId: string;
}) {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Where the list sits: under the search field
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => (value.everyone ? [] : value.users), [value]);
  const chosenIds = useMemo(() => new Set(chosen.map((user) => user.id)), [chosen]);

  // Load once, the first time specific users are wanted
  const wantUsers = !value.everyone;
  useEffect(() => {
    if (!wantUsers || users) return;
    let cancelled = false;
    fetchJson<{ users: PublicUser[] }>("/api/users")
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error, "Couldn't load users"));
      });
    return () => {
      cancelled = true;
    };
  }, [wantUsers, users]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (users ?? [])
      .filter((user) => !user.disabled && user.id !== selfId && !chosenIds.has(user.id))
      .filter((user) => !term || user.name.toLowerCase().includes(term) || user.username.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, query, selfId, chosenIds]);

  // Clicks outside close the dropdown
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // The list is in <body> (below), so it follows the field
  // as chips wrap it to more lines or the window resizes
  const chosenCount = chosen.length;
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = field.current?.getBoundingClientRect();
      if (rect) setPlace({ left: rect.left, top: rect.bottom + 6, width: rect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, chosenCount]);

  // Arrow keys: the highlighted user stays in view
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[id="${listId}-${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, open, listId]);

  function pick(user: PublicUser) {
    if (chosen.length >= MAX_RECIPIENTS) return;
    onChange({ everyone: false, users: [...chosen, user] });
    setQuery("");
    setActive(0);
    input.current?.focus();
  }

  function unpick(id: string) {
    onChange({ everyone: false, users: chosen.filter((user) => user.id !== id) });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      // Never submits the form from here
      event.preventDefault();
      if (open && matches.length) pick(matches[Math.min(active, matches.length - 1)]);
    } else if (event.key === "Escape" && open) {
      // Closes the list, not the notifications panel
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    } else if (event.key === "Backspace" && !query && chosen.length) {
      unpick(chosen[chosen.length - 1].id);
    }
  }

  const tab = (selected: boolean) =>
    cx(
      "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
      selected ? "bg-accent-soft text-accent shadow-sm" : "text-fg-muted hover:text-fg",
    );

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Send to" className="flex gap-1 rounded-lg border border-line bg-sunken p-0.5">
        <button
          type="button"
          role="radio"
          aria-checked={value.everyone}
          className={tab(value.everyone)}
          onClick={() => onChange({ everyone: true })}
        >
          Everyone
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!value.everyone}
          className={tab(!value.everyone)}
          onClick={() => {
            if (value.everyone) onChange({ everyone: false, users: [] });
            setOpen(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          Specific users
        </button>
      </div>

      {!value.everyone && (
        <div ref={box} className="relative">
          <div
            ref={field}
            className={cx(inputClass, "flex h-auto min-h-9 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:border-accent")}
            onClick={() => input.current?.focus()}
          >
            {chosen.map((user) => (
              <span
                key={user.id}
                className="flex items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-2 pr-0.5 text-xs font-medium text-accent"
              >
                {user.name}
                <button
                  type="button"
                  aria-label={`Remove ${user.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    unpick(user.id);
                  }}
                  className="rounded p-0.5 hover:bg-accent/15"
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            <label htmlFor={inputId} className="sr-only">
              Search users
            </label>
            <input
              id={inputId}
              ref={input}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              // Options keep focus here (pointerdown is cancelled
              // on them), so leaving means done choosing
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
              placeholder={chosen.length ? "Add more…" : "Search users by name"}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && matches.length ? `${listId}-${Math.min(active, matches.length - 1)}` : undefined}
              autoComplete="off"
              className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none!"
            />
          </div>

          {/* In <body>: inside the panel, whose own blur would
              keep this one from frosting what's behind it */}
          {open && place && createPortal(
            <ul
              ref={list}
              // Part of the notifications panel (its outside-click
              // check), though it lives in <body>
              data-notifications-layer=""
              style={{ left: place.left, top: place.top, width: place.width }}
              id={listId}
              role="listbox"
              aria-label="Users"
              aria-multiselectable="true"
              className={cx(
                "glass fixed z-50 max-h-64 overflow-y-auto overscroll-contain rounded-2xl border p-1.5",
                // A denser tint than other glass: names stay crisp
                // over the form's text behind
                "[--glass:color-mix(in_oklab,var(--menu)_74%,transparent)]",
                "origin-top animate-[ui-menu-in_0.22s_cubic-bezier(0.2,0.9,0.3,1)_both] [scrollbar-width:thin]",
              )}
            >
              {loadError ? (
                <li className="px-2 py-2 text-xs text-danger">{loadError}</li>
              ) : !users ? (
                <li className="px-2 py-2 text-xs text-fg-subtle">Loading users…</li>
              ) : matches.length === 0 ? (
                <li className="px-2 py-2 text-xs text-fg-subtle">
                  {query.trim() ? `No user matches “${query.trim()}”` : "Everyone is already chosen"}
                </li>
              ) : (
                matches.map((user, index) => (
                  <li
                    key={user.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onPointerDown={(event) => event.preventDefault()}
                    // Only a real mouse move (not the list scrolling
                    // under a still pointer) takes the highlight
                    onPointerMove={() => {
                      if (active !== index) setActive(index);
                    }}
                    onClick={() => pick(user)}
                    style={{ "--i": index } as React.CSSProperties}
                    className={cx(
                      "ui-rise flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition-[background-color,box-shadow] duration-200 ease-out",
                      index === active ? "bg-fg/[0.07] shadow-[inset_0_1px_0_var(--glass-edge)]" : "",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg/10 text-[11px] font-semibold text-fg shadow-[inset_0_1px_0_var(--glass-edge)]"
                    >
                      {user.name.charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{user.name}</span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        @{user.username} · {ROLE_LABELS[user.role]}
                      </span>
                    </span>
                  </li>
                ))
              )}
            </ul>,
            document.body,
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { errorMessage, fetchJson } from "@/lib/client/http";
import { GROUP_MAX_MEMBERS, GROUP_NAME_MAX, type Person, type PublicConversation } from "@/lib/messenger/shared";
import { Avatar } from "./parts";

// --------------------------------------------------
// NEW GROUP (admins and the super admin, in Chats)
//
// A name, then people picked from a searchable list
// (chosen ones show as chips). Creating it opens the
// group's chat; the creator is in it.
// --------------------------------------------------

export default function GroupForm({
  people,
  onCreated,
}: {
  people: Person[] | null;
  onCreated: (conversation: PublicConversation) => void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameId = useId();
  const searchId = useId();

  const term = query.trim().toLowerCase();
  const picked = new Set(chosen.map((person) => person.id));
  const matches = (people ?? []).filter(
    (person) => !picked.has(person.id) && (!term || person.name.toLowerCase().includes(term) || person.username.toLowerCase().includes(term)),
  );
  const full = chosen.length + 1 >= GROUP_MAX_MEMBERS;

  async function create() {
    if (!name.trim() || !chosen.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const { conversation } = await fetchJson<{ conversation: PublicConversation }>("/api/messenger/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, members: chosen.map((person) => person.id) }),
      });
      onCreated(conversation);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the group"));
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label htmlFor={nameId} className="sr-only">
        Group name
      </label>
      <input
        id={nameId}
        autoFocus
        value={name}
        maxLength={GROUP_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        placeholder="Group name"
        className="w-full rounded-xl border border-line bg-fg/[0.05] px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
      />

      {chosen.length > 0 && (
        <ul aria-label="Chosen people" className="flex flex-wrap gap-1.5">
          {chosen.map((person) => (
            <li key={person.id} className="flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-0.5 pr-1 text-xs font-medium text-accent">
              <Avatar id={person.id} name={person.name} size={20} />
              {person.name.split(" ")[0]}
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                onClick={() => setChosen((current) => current.filter((other) => other.id !== person.id))}
                className="rounded-full p-0.5 hover:bg-accent/15"
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={searchId} className="sr-only">
        Search people to add
      </label>
      <div className="flex items-center gap-2 rounded-full bg-fg/[0.07] px-3 py-1.5 focus-within:shadow-[0_0_0_1.5px_var(--accent)]">
        <Icon name="search" size={14} className="text-fg-subtle" />
        <input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add people"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none!"
        />
      </div>

      <ul aria-label="People" className="max-h-52 space-y-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {!people && <li className="px-2 py-2 text-xs text-fg-subtle">Loading people…</li>}
        {people && matches.length === 0 && <li className="px-2 py-2 text-xs text-fg-subtle">No one else to add</li>}
        {matches.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              disabled={full}
              onClick={() => {
                setChosen((current) => [...current, person]);
                setQuery("");
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-fg/[0.06] disabled:opacity-40"
            >
              <Avatar id={person.id} name={person.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{person.name}</span>
                <span className="block truncate text-[11px] text-fg-subtle">@{person.username}</span>
              </span>
              <Icon name="check" size={14} className="text-fg-subtle opacity-0" />
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!name.trim() || !chosen.length || busy}
        className={cx(
          "w-full rounded-xl bg-accent py-2 text-sm font-semibold text-on-accent transition-opacity disabled:opacity-35",
          busy && "cursor-wait",
        )}
      >
        {busy ? "Creating…" : `Create group${chosen.length ? ` with ${chosen.length + 1} people` : ""}`}
      </button>
    </form>
  );
}

"use client";

import { useEffect, useId, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import { GROUP_NAME_MAX, type Person, type PublicConversation } from "@/lib/messenger/shared";
import { Avatar } from "./parts";

// --------------------------------------------------
// A GROUP'S MEMBERS (inside its chat window)
//
// Everyone in it. Admins in the group and the super admin
// can rename it, add and remove people, and delete it;
// anyone in it can leave. Each change is posted in the
// group by the server.
// --------------------------------------------------

export default function GroupPanel({
  conversation,
  selfId,
  onChange,
  onClose,
}: {
  conversation: PublicConversation;
  selfId: string;
  // The updated group, or null once left / deleted
  onChange: (conversation: PublicConversation | null) => void;
  onClose: () => void;
}) {
  const group = conversation.group!;
  const manage = group.canManage;
  const inGroup = group.members.some((member) => member.id === selfId);
  const [name, setName] = useState(group.name);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameId = useId();
  const addId = useId();
  const url = `/api/messenger/groups/${conversation.id}`;

  // People to add (managers only)
  useEffect(() => {
    if (!manage) return;
    let cancelled = false;
    fetchJson<{ people: Person[] }>("/api/messenger/people")
      .then((data) => {
        if (!cancelled) setPeople(data.people);
      })
      .catch((err) => logRequestError(err, "Load people"));
    return () => {
      cancelled = true;
    };
  }, [manage]);

  async function change(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const { conversation: updated } = await fetchJson<{ conversation: PublicConversation }>(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      onChange(updated);
      setQuery("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't change the group"));
    } finally {
      setBusy(false);
    }
  }

  async function leaveOrDelete(kind: "leave" | "delete") {
    const question =
      kind === "delete"
        ? `Delete “${group.name}” and all its messages for everyone? This can't be undone.`
        : `Leave “${group.name}”? You'll stop getting its messages.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError("");
    try {
      await fetchJson(kind === "delete" ? url : `${url}/leave`, { method: kind === "delete" ? "DELETE" : "POST" });
      onChange(null);
    } catch (err) {
      setError(errorMessage(err, kind === "delete" ? "Couldn't delete the group" : "Couldn't leave the group"));
      setBusy(false);
    }
  }

  const memberIds = new Set(group.members.map((member) => member.id));
  const term = query.trim().toLowerCase();
  const addable = (people ?? []).filter(
    (person) =>
      !memberIds.has(person.id) &&
      term &&
      (person.name.toLowerCase().includes(term) || person.username.toLowerCase().includes(term)),
  );

  return (
    <div className="glass-menu absolute inset-x-0 bottom-0 top-[53px] z-10 flex flex-col animate-[ui-menu-in_0.18s_ease-out_both]">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <p className="text-sm font-semibold text-fg">Members</p>
        <button type="button" onClick={onClose} className="rounded-full px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
          Back to chat
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 [scrollbar-width:thin]">
        {manage && (
          <form
            className="space-y-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && name.trim() !== group.name) void change({ name });
            }}
          >
            <label htmlFor={nameId} className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
              Group name
            </label>
            <div className="flex gap-2">
              <input
                id={nameId}
                value={name}
                maxLength={GROUP_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-fg/[0.05] px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !name.trim() || name.trim() === group.name}
                className="rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-35"
              >
                Save
              </button>
            </div>
          </form>
        )}

        {manage && (
          <div className="space-y-1">
            <label htmlFor={addId} className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
              Add people
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-fg/[0.05] px-3 py-1.5 focus-within:border-accent">
              <Icon name="search" size={14} className="text-fg-subtle" />
              <input
                id={addId}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none!"
              />
            </div>
            {term && (
              <ul className="space-y-0.5 pt-1">
                {addable.length === 0 && <li className="px-1 text-xs text-fg-subtle">No one else matches</li>}
                {addable.slice(0, 8).map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => change({ add: [person.id] })}
                      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-fg/[0.06] disabled:opacity-50"
                    >
                      <Avatar id={person.id} name={person.name} size={28} />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{person.name}</span>
                      <span className="text-xs font-medium text-accent">Add</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
            {group.members.length} {group.members.length === 1 ? "person" : "people"}
          </p>
          <ul className="space-y-0.5">
            {group.members.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                <Avatar id={member.id} name={member.name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-sm text-fg", member.disabled && "text-fg-subtle line-through")}>
                    {member.name}
                    {member.id === selfId && <span className="text-fg-subtle"> (you)</span>}
                  </span>
                  <span className="block truncate text-[11px] text-fg-subtle">
                    {member.id === group.createdBy ? "Created the group" : `@${member.username}`}
                  </span>
                </span>
                {manage && member.id !== selfId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.name} from “${group.name}”?`)) void change({ remove: [member.id] });
                    }}
                    aria-label={`Remove ${member.name}`}
                    title="Remove from group"
                    className="rounded-full p-1.5 text-fg-subtle hover:bg-fg/[0.08] hover:text-danger disabled:opacity-50"
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-line px-4 py-3">
        {inGroup && (
          <button
            type="button"
            disabled={busy}
            onClick={() => leaveOrDelete("leave")}
            className="flex-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-50"
          >
            Leave group
          </button>
        )}
        {manage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => leaveOrDelete("delete")}
            className="flex-1 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Delete group
          </button>
        )}
      </div>
    </div>
  );
}

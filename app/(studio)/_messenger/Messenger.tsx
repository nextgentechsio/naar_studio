"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import { canReadAllChats } from "@/lib/auth/roles";
import type { AuditConversation, AuditList, ConversationList, Person, PublicConversation } from "@/lib/messenger/shared";
import { useStudio } from "../_components/StudioProvider";
import ChatWindow from "./ChatWindow";
import { Avatar, UnreadBadge, shortTime } from "./parts";

// --------------------------------------------------
// MESSENGER (floating, bottom right)
//
// A round chat button with the unread count opens Chats:
// recent conversations, and a search to start one with
// anyone. Chats open as windows docked along the bottom
// (up to 3; 1 on phones). A minimised chat becomes a
// round head above the button, with its own badge.
// The list is checked every few seconds while a chat is
// open, less often otherwise (lib/messenger/server.ts).
// The super admin also has All chats: anyone's, read only.
// --------------------------------------------------

const FAST_MS = 5000;
const SLOW_MS = 20_000;
const MAX_WINDOWS = 3;

type Open = { id: string; minimized: boolean };
type AnyConversation = PublicConversation | AuditConversation;

const isAudit = (conversation: AnyConversation): conversation is AuditConversation => "members" in conversation;
// The face of a chat: the other person (or, read only,
// the first of the two)
const faceOf = (conversation: AnyConversation) => (isAudit(conversation) ? conversation.members[0] : conversation.other);
const nameOf = (conversation: AnyConversation) =>
  isAudit(conversation) ? conversation.members.map((member) => member.name).join(" & ") : conversation.other.name;
const unreadOf = (conversation: AnyConversation) => (isAudit(conversation) ? 0 : conversation.unread);

export default function Messenger() {
  const { currentUser } = useStudio();
  const canAudit = canReadAllChats(currentUser);
  const [list, setList] = useState<ConversationList | null>(null);
  const [panel, setPanel] = useState(false);
  const [open, setOpen] = useState<Open[]>([]);
  // Chats opened from the list or search (not in it yet)
  const [extra, setExtra] = useState<Record<string, AnyConversation>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetchJson<ConversationList>("/api/messenger/conversations")
      .then(setList)
      .catch((error) => logRequestError(error, "Load chats"));
  }, []);

  // Faster while a chat is showing
  const anyOpen = open.some((item) => !item.minimized);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") load();
    };
    check();
    const timer = setInterval(check, anyOpen ? FAST_MS : SLOW_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, anyOpen]);

  // Phones: one chat at a time, full width
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Outside click and Escape close the Chats list
  useEffect(() => {
    if (!panel) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPanel(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  const byId = useMemo(() => {
    const map = new Map<string, AnyConversation>(Object.entries(extra));
    for (const conversation of list?.conversations ?? []) map.set(conversation.id, conversation);
    return map;
  }, [list, extra]);

  function show(conversation: AnyConversation) {
    setExtra((current) => (current[conversation.id] ? current : { ...current, [conversation.id]: conversation }));
    setOpen((current) => {
      const rest = current.filter((item) => item.id !== conversation.id);
      const next = [...rest, { id: conversation.id, minimized: false }];
      // Too many showing: the oldest one closes
      const showing = next.filter((item) => !item.minimized);
      const limit = narrow ? 1 : MAX_WINDOWS;
      if (showing.length <= limit) return next;
      const drop = new Set(showing.slice(0, showing.length - limit).map((item) => item.id));
      return narrow
        ? next.map((item) => (drop.has(item.id) ? { ...item, minimized: true } : item))
        : next.filter((item) => !drop.has(item.id));
    });
    setFocusId(conversation.id);
    setPanel(false);
  }

  function minimize(id: string) {
    setOpen((current) => current.map((item) => (item.id === id ? { ...item, minimized: true } : item)));
  }

  function close(id: string) {
    setOpen((current) => current.filter((item) => item.id !== id));
  }

  const unread = list?.unread ?? 0;
  const windows = open.filter((item) => !item.minimized && byId.has(item.id));
  const heads = open.filter((item) => item.minimized && byId.has(item.id));

  return (
    <>
      {/* Docked chat windows, right to left from the button */}
      {windows.length > 0 && (
        <div
          className={cx(
            "pointer-events-none fixed z-40 flex items-end gap-3",
            narrow ? "inset-x-0 bottom-0 h-[82dvh]" : "bottom-0 right-[92px] h-[min(480px,78vh)] flex-row-reverse",
          )}
        >
          {windows.map((item) => (
            <div key={item.id} className={cx("pointer-events-auto h-full", narrow ? "w-full" : "w-[336px]")}>
              <ChatWindow
                conversation={byId.get(item.id)!}
                autoFocus={focusId === item.id}
                onClose={() => close(item.id)}
                onMinimize={() => minimize(item.id)}
                onActivity={load}
              />
            </div>
          ))}
        </div>
      )}

      {/* The button, minimised chats above it, and the list */}
      {/* Phones: hidden behind an open chat (it would cover
          the send button); − or × brings it back */}
      <div ref={root} className={cx("fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3", narrow && windows.length > 0 && "hidden")}>
        {panel && <ChatsPanel list={list} onPick={show} canAudit={canAudit} />}

        {heads.map((item) => {
          const conversation = byId.get(item.id)!;
          const face = faceOf(conversation);
          const name = nameOf(conversation);
          const unreadHere = unreadOf(conversation);
          return (
            <div key={item.id} className="group relative animate-[ui-pop-in_0.24s_cubic-bezier(0.2,0.9,0.3,1)_both]">
              <button
                type="button"
                onClick={() => show(conversation)}
                aria-label={`Open chat with ${name}${unreadHere ? `, ${unreadHere} unread` : ""}`}
                title={name}
                className="relative block rounded-full transition-transform hover:scale-105 active:scale-95"
              >
                <Avatar id={face.id} name={face.name} size={48} className="shadow-[0_8px_24px_-6px_rgb(0_0_0/0.45)]" />
                {isAudit(conversation) && (
                  <span className="glass absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border text-fg-muted">
                    <Icon name="eye" size={11} />
                  </span>
                )}
              </button>
              <UnreadBadge count={unreadHere} className="pointer-events-none absolute -right-1 -top-1" />
              <button
                type="button"
                onClick={() => close(item.id)}
                aria-label={`Close chat with ${name}`}
                className="glass absolute -left-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border text-fg-muted group-hover:flex focus-visible:flex"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setPanel((value) => !value)}
          aria-expanded={panel}
          aria-label={unread ? `Chats, ${unread} unread` : "Chats"}
          title="Chats"
          className={cx(
            "glass relative flex h-14 w-14 items-center justify-center rounded-full border text-fg transition-transform duration-200 hover:scale-105 active:scale-95",
            panel && "text-accent",
          )}
        >
          <Icon name={panel ? "close" : "chat"} size={24} />
          <UnreadBadge count={unread} className="absolute -right-1 -top-1" />
        </button>
      </div>
    </>
  );
}

// The Chats list: recent conversations, and search to
// find anyone (people load the first time it opens)
function ChatsPanel({
  list,
  onPick,
  canAudit,
}: {
  list: ConversationList | null;
  onPick: (conversation: AnyConversation) => void;
  canAudit: boolean;
}) {
  const [query, setQuery] = useState("");
  // Super admin: their own chats, or everyone's
  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [all, setAll] = useState<AuditList | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const searchId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ people: Person[] }>("/api/messenger/people")
      .then((data) => {
        if (!cancelled) setPeople(data.people);
      })
      .catch((err) => {
        logRequestError(err, "Load people");
        if (!cancelled) setError(errorMessage(err, "Couldn't load people"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Everyone's chats, fresh each time the tab opens
  useEffect(() => {
    if (tab !== "all") return;
    let cancelled = false;
    fetchJson<AuditList>("/api/messenger/conversations?scope=all")
      .then((data) => {
        if (!cancelled) setAll(data);
      })
      .catch((err) => {
        logRequestError(err, "Load all chats");
        if (!cancelled) setError(errorMessage(err, "Couldn't load all chats"));
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const term = query.trim().toLowerCase();
  const matches = (person: { name: string; username: string }) =>
    !term || person.name.toLowerCase().includes(term) || person.username.toLowerCase().includes(term);

  const conversations = (list?.conversations ?? []).filter((conversation) => matches(conversation.other));
  const chatted = new Set((list?.conversations ?? []).map((conversation) => conversation.other.id));
  // Searching: people you haven't chatted with yet
  const newPeople = term ? (people ?? []).filter((person) => !chatted.has(person.id) && matches(person)) : [];

  function start(person: Person) {
    setStarting(person.id);
    setError("");
    fetchJson<{ conversation: PublicConversation }>("/api/messenger/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: person.id }),
    })
      .then(({ conversation }) => onPick(conversation))
      .catch((err) => setError(errorMessage(err, "Couldn't open the chat")))
      .finally(() => setStarting(null));
  }

  return (
    <div
      role="dialog"
      aria-label="Chats"
      className="glass flex max-h-[min(72vh,560px)] w-[min(calc(100vw-40px),360px)] origin-bottom-right animate-[ui-pop-in_0.24s_cubic-bezier(0.2,0.9,0.3,1)_both] flex-col overflow-hidden rounded-2xl border"
    >
      <div className="shrink-0 space-y-2.5 px-4 pb-3 pt-3.5">
        <p className="text-lg font-semibold tracking-tight text-fg">Chats</p>
        {canAudit && (
          <div role="tablist" aria-label="Whose chats" className="flex gap-1 rounded-full bg-fg/[0.06] p-0.5">
            {(
              [
                ["mine", "My chats"],
                ["all", "All chats"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cx(
                  "flex-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  tab === value ? "bg-accent-soft text-accent shadow-sm" : "text-fg-muted hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label htmlFor={searchId} className="sr-only">
          Search people and chats
        </label>
        <div className="flex items-center gap-2 rounded-full bg-fg/[0.07] px-3 py-1.5 transition-shadow focus-within:shadow-[0_0_0_1.5px_var(--accent)]">
          <Icon name="search" size={15} className="text-fg-subtle" />
          <input
            id={searchId}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "all" ? "Search by name" : "Search people"}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none!"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 [scrollbar-width:thin]">
        {error && <p className="px-2 py-2 text-xs text-danger">{error}</p>}
        {tab === "all" ? (
          <AllChats data={all} matches={matches} onPick={onPick} />
        ) : (
          <>
            {!list && <p className="px-2 py-6 text-center text-xs text-fg-subtle">Loading chats…</p>}

            {list && conversations.length === 0 && !term && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-fg">No chats yet</p>
                <p className="mt-1 text-xs text-fg-subtle">Search for someone to start one.</p>
              </div>
            )}

            <ul>
              {conversations.map((conversation, index) => (
                <li key={conversation.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
                  <button
                    type="button"
                    onClick={() => onPick(conversation)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-fg/[0.06]"
                  >
                    <Avatar id={conversation.other.id} name={conversation.other.name} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-sm", conversation.unread ? "font-semibold text-fg" : "font-medium text-fg")}>
                        {conversation.other.name}
                      </span>
                      <span className={cx("flex gap-1 text-xs", conversation.unread ? "font-semibold text-fg" : "text-fg-subtle")}>
                        <span className="min-w-0 truncate">
                          {conversation.last ? `${conversation.last.mine ? "You: " : ""}${conversation.last.body}` : "No messages yet"}
                        </span>
                        {conversation.last && <span className="shrink-0">· {shortTime(conversation.last.at)}</span>}
                      </span>
                    </span>
                    {conversation.unread > 0 && <span aria-label={`${conversation.unread} unread`} className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
                  </button>
                </li>
              ))}
            </ul>

            {term && (
              <>
                {newPeople.length > 0 && (
                  <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">More people</p>
                )}
                <ul>
                  {newPeople.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        disabled={starting === person.id}
                        onClick={() => start(person)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-fg/[0.06] disabled:opacity-60"
                      >
                        <Avatar id={person.id} name={person.name} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">{person.name}</span>
                          <span className="block truncate text-xs text-fg-subtle">@{person.username}</span>
                        </span>
                        <Icon name="edit" size={15} className="text-fg-subtle" />
                      </button>
                    </li>
                  ))}
                </ul>
                {people && conversations.length === 0 && newPeople.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-fg-subtle">No one matches “{query.trim()}”</p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Everyone is told: no silent monitoring */}
      <p className="flex shrink-0 items-center justify-center gap-1.5 border-t border-line px-4 py-2 text-[10px] text-fg-subtle">
        <Icon name="eye" size={11} />
        {canAudit ? "You can read every chat. People are told this here." : "Chats are private, but the super admin can review them."}
      </p>
    </div>
  );
}

// Super admin: everyone's chats, read only
function AllChats({
  data,
  matches,
  onPick,
}: {
  data: AuditList | null;
  matches: (person: { name: string; username: string }) => boolean;
  onPick: (conversation: AnyConversation) => void;
}) {
  if (!data) return <p className="px-2 py-6 text-center text-xs text-fg-subtle">Loading all chats…</p>;
  const rows = data.conversations.filter((conversation) => conversation.members.some(matches));
  if (!rows.length) {
    return <p className="px-2 py-8 text-center text-xs text-fg-subtle">{data.conversations.length ? "No chat matches" : "No one has chatted yet"}</p>;
  }

  return (
    <ul>
      {rows.map((conversation, index) => {
        const [first, second] = conversation.members;
        const sender = conversation.members.find((member) => member.id === conversation.last?.senderId);
        return (
          <li key={conversation.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => onPick(conversation)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-fg/[0.06]"
            >
              <span className="relative h-11 w-11 shrink-0">
                <Avatar id={first.id} name={first.name} size={28} className="absolute left-0 top-0" />
                <Avatar id={second.id} name={second.name} size={28} className="absolute bottom-0 right-0 ring-2 ring-[var(--canvas)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">
                  {first.name} &amp; {second.name}
                </span>
                <span className="flex gap-1 text-xs text-fg-subtle">
                  <span className="min-w-0 truncate">
                    {conversation.last ? `${sender ? `${sender.name.split(" ")[0]}: ` : ""}${conversation.last.body}` : ""}
                  </span>
                  {conversation.last && <span className="shrink-0">· {shortTime(conversation.last.at)}</span>}
                </span>
              </span>
              <Icon name="eye" size={14} className="shrink-0 text-fg-subtle" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

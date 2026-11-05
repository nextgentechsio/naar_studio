"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { ApiError, errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import {
  MESSAGE_MAX,
  type AuditConversation,
  type MessagePage,
  type PublicConversation,
  type PublicMessage,
} from "@/lib/messenger/shared";
import GroupPanel from "./GroupPanel";
import { Avatar, dividerTime, GroupAvatar } from "./parts";

// --------------------------------------------------
// ONE CHAT WINDOW (docked at the bottom of the screen)
//
// Latest messages first load, then new ones every few
// seconds while the tab is visible; scrolling to the top
// loads older ones. Your messages show at once while they
// send. It stays at the bottom as messages arrive, unless
// you've scrolled up to read.
// Super admin viewing someone else's chat (an
// AuditConversation): read only, one person on each side,
// and nothing marked read.
// Groups: each sender's name and avatar on their
// messages, events ("Priya added Bob") centred, "Seen by"
// under yours, and a members panel. The super admin opens
// groups they aren't in read only (and can manage them).
// --------------------------------------------------

const POLL_MS = 3000;
// Gap that gets a time divider
const DIVIDER_MS = 20 * 60 * 1000;
// Messages this close from one person are one group
const GROUP_MS = 3 * 60 * 1000;

type Pending = { key: string; body: string; failed: boolean };

export default function ChatWindow({
  conversation,
  onClose,
  onMinimize,
  onActivity,
  autoFocus,
  selfId,
  onGroupChange,
  canDelete,
}: {
  // The super admin: delete any message, or the chat
  canDelete: boolean;
  conversation: PublicConversation | AuditConversation;
  selfId: string;
  // A group changed (renamed, members) or, with null,
  // this person left it or it was deleted
  onGroupChange: (conversation: PublicConversation | null) => void;
  onClose: () => void;
  onMinimize: () => void;
  // Something changed the Chats list (read, sent)
  onActivity: () => void;
  autoFocus: boolean;
}) {
  const id = conversation.id;
  const base = `/api/messenger/conversations/${id}`;
  const [messages, setMessages] = useState<PublicMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const audit = "members" in conversation ? conversation : null;
  const [otherReadAt, setOtherReadAt] = useState<string | null>(audit ? null : (conversation as PublicConversation).otherReadAt);
  const [readers, setReaders] = useState<MessagePage["readers"]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const group = audit ? null : (conversation as PublicConversation).group;
  // The super admin can open groups they aren't in
  const inGroup = !group || group.members.some((member) => member.id === selfId);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Near the bottom: new messages keep it there
  const stick = useRef(true);
  // Kept while older messages are added above
  const restore = useRef<number | null>(null);
  const latestId = useRef<string | null>(null);

  const auditing = Boolean(audit) || !inGroup;
  const markRead = useCallback(() => {
    // Reading someone else's chat leaves it unread for them
    if (auditing) return;
    fetchJson(`${base}/read`, { method: "POST" })
      .then(onActivity)
      .catch((err) => logRequestError(err, "Mark chat read"));
  }, [base, onActivity, auditing]);

  // Messages the super admin deleted leave this window
  const dropDeleted = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    setMessages((current) => (current && current.some((message) => gone.has(message.id)) ? current.filter((message) => !gone.has(message.id)) : current));
  }, []);

  // The chat itself was deleted: this window closes
  const goneRef = useRef(onGroupChange);
  useEffect(() => {
    goneRef.current = onGroupChange;
  }, [onGroupChange]);
  const whenGone = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) {
      goneRef.current(null);
      return true;
    }
    return false;
  }, []);

  // Adds messages, once each, in order
  const merge = useCallback((incoming: PublicMessage[], where: "end" | "start") => {
    setMessages((current) => {
      const have = new Set((current ?? []).map((message) => message.id));
      const fresh = incoming.filter((message) => !have.has(message.id));
      if (!fresh.length) return current ?? [];
      const next = where === "end" ? [...(current ?? []), ...fresh] : [...fresh, ...(current ?? [])];
      latestId.current = next[next.length - 1]?.id ?? null;
      return next;
    });
  }, []);

  // First page, then new messages every few seconds
  useEffect(() => {
    let cancelled = false;

    fetchJson<MessagePage>(`${base}/messages`)
      .then((page) => {
        if (cancelled) return;
        stick.current = true;
        latestId.current = page.messages[page.messages.length - 1]?.id ?? null;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setOtherReadAt(page.otherReadAt);
        setReaders(page.readers);
        markRead();
      })
      .catch((err) => {
        if (whenGone(err)) return;
        logRequestError(err, "Load chat");
        if (!cancelled) setError(errorMessage(err, "Couldn't load this chat"));
      });

    const poll = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      const after = latestId.current;
      fetchJson<MessagePage>(`${base}/messages${after ? `?after=${after}` : ""}`)
        .then((page) => {
          if (cancelled) return;
          setOtherReadAt(page.otherReadAt);
          setReaders(page.readers);
          dropDeleted(page.deleted);
          if (!page.messages.length) return;
          merge(page.messages, "end");
          if (page.messages.some((message) => !message.mine)) markRead();
        })
        .catch((err) => {
          if (!whenGone(err)) logRequestError(err, "Check chat");
        });
    };
    const timer = setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, merge, markRead, dropDeleted, whenGone]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // Scroll: stay at the bottom, or keep your place when
  // older messages arrive above
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (restore.current !== null) {
      box.scrollTop = box.scrollHeight - restore.current;
      restore.current = null;
    } else if (stick.current) {
      box.scrollTop = box.scrollHeight;
    }
  }, [messages, pending]);

  function onScroll() {
    const box = scroller.current;
    if (!box) return;
    stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (box.scrollTop < 48 && hasMore && !loadingOlder && messages?.length) loadOlder();
  }

  function loadOlder() {
    const first = messages?.[0]?.id;
    if (!first) return;
    setLoadingOlder(true);
    fetchJson<MessagePage>(`${base}/messages?before=${first}`)
      .then((page) => {
        restore.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
        merge(page.messages, "start");
        setHasMore(page.hasMore);
      })
      .catch((err) => logRequestError(err, "Load older messages"))
      .finally(() => setLoadingOlder(false));
  }

  function deliver(item: Pending) {
    fetchJson<{ message: PublicMessage }>(`${base}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: item.body }),
    })
      .then(({ message }) => {
        setPending((current) => current.filter((other) => other.key !== item.key));
        merge([message], "end");
        onActivity();
      })
      .catch((err) => {
        logRequestError(err, "Send message");
        setError(errorMessage(err, "Couldn't send"));
        setPending((current) => current.map((other) => (other.key === item.key ? { ...other, failed: true } : other)));
      });
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    const item = { key: `${Date.now()}-${Math.random()}`, body, failed: false };
    stick.current = true;
    setDraft("");
    setError("");
    setPending((current) => [...current, item]);
    deliver(item);
  }

  function removeMessage(message: PublicMessage) {
    if (!window.confirm("Delete this message for everyone? This can't be undone.")) return;
    fetchJson(`${base}/messages/${message.id}`, { method: "DELETE" })
      .then(() => {
        dropDeleted([message.id]);
        onActivity();
      })
      .catch((err) => setError(errorMessage(err, "Couldn't delete the message")));
  }

  function removeChat() {
    const what = group ? `the group “${group.name}”` : `this chat with ${other.name}`;
    if (!window.confirm(`Delete ${what} and all its messages for everyone? This can't be undone.`)) return;
    fetchJson(base, { method: "DELETE" })
      .then(() => onGroupChange(null))
      .catch((err) => setError(errorMessage(err, "Couldn't delete the chat")));
  }

  function retry(item: Pending) {
    setError("");
    setPending((current) => current.map((other) => (other.key === item.key ? { ...other, failed: false } : other)));
    deliver({ ...item, failed: false });
  }

  // Left: the other person (or, auditing, the first
  // member); right: you (or the second member)
  const other = audit ? audit.members[0] : (conversation as PublicConversation).other;
  const right = audit ? audit.members[1] : null;
  const onRight = (message: PublicMessage) => (right ? message.senderId === right.id : message.mine);
  const nameOf = (message: PublicMessage) =>
    group ? message.senderName : message.senderId === other.id ? other.name : (right?.name ?? "You");
  const list = messages ?? [];
  const lastMine = [...list].reverse().find((message) => message.mine && !message.system);
  const seenBy = group && lastMine ? readers.filter((reader) => reader.readAt >= lastMine.createdAt) : [];
  const othersInGroup = group ? group.members.filter((member) => member.id !== selfId).length : 0;
  const seenLabel = group
    ? seenBy.length === 0
      ? "Sent"
      : seenBy.length >= othersInGroup && othersInGroup > 1
        ? "Seen by everyone"
        : `Seen by ${seenBy.map((reader) => reader.name.split(" ")[0]).join(", ")}`
    : lastMine && otherReadAt && otherReadAt >= lastMine.createdAt
      ? "Seen"
      : "Sent";

  return (
    <section
      role="dialog"
      aria-label={group ? `Group chat ${group.name}` : `Chat with ${other.name}`}
      className="relative glass origin-bottom animate-[ui-pop-in_0.26s_cubic-bezier(0.2,0.9,0.3,1)_both] flex h-full w-full flex-col overflow-hidden rounded-t-2xl border border-b-0 sm:rounded-2xl sm:border-b"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onMinimize();
        }
      }}
    >
      {/* Header: click to minimise */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2">
        <button type="button" onClick={onMinimize} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label={`Minimise chat with ${right ? `${other.name} and ${right.name}` : other.name}`}>
          {group ? (
            <GroupAvatar members={group.members} size={32} />
          ) : right ? (
            <span className="relative h-9 w-9 shrink-0">
              <Avatar id={other.id} name={other.name} size={24} className="absolute left-0 top-0" />
              <Avatar id={right.id} name={right.name} size={24} className="absolute bottom-0 right-0 ring-2 ring-[var(--canvas)]" />
            </span>
          ) : (
            <Avatar id={other.id} name={other.name} size={32} />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">{right ? `${other.name} & ${right.name}` : other.name}</span>
            <span className="flex items-center gap-1 truncate text-[11px] text-fg-subtle">
              {group ? (
                <>
                  {group.members.length} {group.members.length === 1 ? "member" : "members"}
                  {!inGroup && (
                    <>
                      {" · "}
                      <Icon name="eye" size={11} /> Read only
                    </>
                  )}
                </>
              ) : right ? (
                <>
                  <Icon name="eye" size={11} /> Read only
                </>
              ) : other.disabled ? (
                "Account disabled"
              ) : (
                `@${other.username}`
              )}
            </span>
          </span>
        </button>
        {group && (
          <button
            type="button"
            onClick={() => setMembersOpen((value) => !value)}
            aria-label="Members"
            aria-expanded={membersOpen}
            title="Members"
            className={cx("rounded-full p-1.5 transition-colors hover:bg-fg/[0.08] hover:text-fg", membersOpen ? "bg-accent-soft text-accent" : "text-fg-muted")}
          >
            <Icon name="users" size={16} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={removeChat}
            aria-label={group ? "Delete group" : "Delete chat"}
            title={group ? "Delete group for everyone" : "Delete chat for everyone"}
            className="rounded-full p-1.5 text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Icon name="trash" size={15} />
          </button>
        )}
        <button type="button" onClick={onMinimize} aria-label="Minimise" title="Minimise" className="rounded-full p-1.5 text-fg-muted transition-colors hover:bg-fg/[0.08] hover:text-fg">
          <Icon name="minus" size={16} />
        </button>
        <button type="button" onClick={onClose} aria-label="Close chat" title="Close" className="rounded-full p-1.5 text-fg-muted transition-colors hover:bg-fg/[0.08] hover:text-fg">
          <Icon name="close" size={16} />
        </button>
      </header>

      {group && membersOpen && (
        <GroupPanel
          conversation={conversation as PublicConversation}
          selfId={selfId}
          onChange={(updated) => {
            onGroupChange(updated);
            if (!updated) setMembersOpen(false);
          }}
          onClose={() => setMembersOpen(false)}
        />
      )}

      {/* Messages */}
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin]" aria-live="polite">
        {!messages && !error && <p className="py-8 text-center text-xs text-fg-subtle">Loading…</p>}
        {loadingOlder && <p className="pb-2 text-center text-[11px] text-fg-subtle">Loading earlier messages…</p>}

        {messages && list.length === 0 && pending.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {group ? <GroupAvatar members={group.members} size={56} /> : <Avatar id={other.id} name={other.name} size={56} />}
            <p className="text-sm font-semibold text-fg">{other.name}</p>
            <p className="text-xs text-fg-subtle">Say hi to start the conversation.</p>
          </div>
        )}

        <ol className="flex flex-col">
          {list.map((message, index) => {
            const previous = list[index - 1];
            const next = list[index + 1];
            const time = new Date(message.createdAt).getTime();
            const divider = !previous || time - new Date(previous.createdAt).getTime() > DIVIDER_MS;
            const joinsPrevious =
              !divider && !previous?.system && previous?.senderId === message.senderId && time - new Date(previous.createdAt).getTime() < GROUP_MS;
            const joinsNext =
              next &&
              !next.system &&
              next.senderId === message.senderId &&
              new Date(next.createdAt).getTime() - time < GROUP_MS &&
              new Date(next.createdAt).getTime() - time <= DIVIDER_MS;
            const mine = onRight(message);
            const showAvatar = !mine && !joinsNext;
            // Whose message, at the start of each run (groups,
            // and both sides when auditing)
            const showName = (Boolean(right) || (Boolean(group) && !mine)) && !joinsPrevious;

            if (message.system) {
              return (
                <li key={message.id} className="mt-2.5 flex flex-col">
                  {divider && (
                    <p className="mb-2 mt-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
                      {dividerTime(message.createdAt)}
                    </p>
                  )}
                  <p className="group/msg mx-auto flex max-w-[85%] items-center gap-1 text-center text-[11px] leading-4 text-fg-subtle">
                    {message.body}
                    {canDelete && <DeleteButton onClick={() => removeMessage(message)} />}
                  </p>
                </li>
              );
            }

            return (
              <li key={message.id} className={cx("flex flex-col", joinsPrevious ? "mt-0.5" : "mt-2.5")}>
                {divider && (
                  <p className="mb-2 mt-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
                    {dividerTime(message.createdAt)}
                  </p>
                )}
                {showName && (
                  <span className={cx("mb-0.5 px-1 text-[10px] font-medium text-fg-subtle", mine ? "text-right" : "pl-9")}>
                    {nameOf(message)}
                  </span>
                )}
                <div className={cx("group/msg flex items-end gap-1.5", mine ? "justify-end" : "justify-start")}>
                  {canDelete && mine && <DeleteButton onClick={() => removeMessage(message)} />}
                  {!mine && (
                    <span className="w-7 shrink-0">
                      {showAvatar &&
                        (group ? (
                          <Avatar id={message.senderId} name={message.senderName} size={28} />
                        ) : (
                          <Avatar id={other.id} name={other.name} size={28} />
                        ))}
                    </span>
                  )}
                  <p
                    title={new Date(message.createdAt).toLocaleString()}
                    className={cx(
                      "max-w-[75%] whitespace-pre-wrap break-words px-3 py-1.5 text-sm leading-5",
                      mine && !right && "bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]",
                      mine && right && "bg-accent-soft text-fg shadow-[inset_0_1px_0_var(--glass-edge)]",
                      !mine && "bg-fg/[0.08] text-fg shadow-[inset_0_1px_0_var(--glass-edge)]",
                      // Rounded, with the joined corners tighter
                      "rounded-[18px]",
                      mine && joinsPrevious && "rounded-tr-md",
                      mine && joinsNext && "rounded-br-md",
                      !mine && joinsPrevious && "rounded-tl-md",
                      !mine && joinsNext && "rounded-bl-md",
                    )}
                  >
                    {message.body}
                  </p>
                  {canDelete && !mine && <DeleteButton onClick={() => removeMessage(message)} />}
                </div>
                {message.id === lastMine?.id && pending.length === 0 && (
                  <span className="mt-0.5 pr-1 text-right text-[10px] text-fg-subtle">{seenLabel}</span>
                )}
              </li>
            );
          })}

          {/* Yours, still sending */}
          {pending.map((item) => (
            <li key={item.key} className="mt-0.5 flex flex-col items-end">
              <p className={cx("max-w-[75%] whitespace-pre-wrap break-words rounded-[18px] bg-accent px-3 py-1.5 text-sm leading-5 text-on-accent", item.failed ? "opacity-50" : "opacity-70")}>
                {item.body}
              </p>
              {item.failed ? (
                <button type="button" onClick={() => retry(item)} className="mt-0.5 pr-1 text-[10px] font-medium text-danger hover:underline">
                  Not sent · Tap to retry
                </button>
              ) : (
                <span className="mt-0.5 pr-1 text-[10px] text-fg-subtle">Sending…</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      {error && <p className="shrink-0 px-3 pb-1 text-[11px] text-danger">{error}</p>}

      {/* Composer */}
      {right ? (
        <p className="shrink-0 border-t border-line px-3 py-3 text-center text-xs text-fg-subtle">
          Read only. Only {other.name} and {right.name} can write here.
        </p>
      ) : !inGroup ? (
        <p className="shrink-0 border-t border-line px-3 py-3 text-center text-xs text-fg-subtle">
          Read only. You&apos;re not in this group{group?.canManage ? ", but you can manage it from Members" : ""}.
        </p>
      ) : other.disabled ? (
        <p className="shrink-0 border-t border-line px-3 py-3 text-center text-xs text-fg-subtle">
          This account is disabled, so it can&apos;t get messages.
        </p>
      ) : (
        <form
          className="flex shrink-0 items-end gap-2 border-t border-line px-2.5 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor={`chat-${id}`} className="sr-only">
            Message {other.name}
          </label>
          <textarea
            id={`chat-${id}`}
            ref={input}
            rows={1}
            value={draft}
            maxLength={MESSAGE_MAX}
            placeholder="Aa"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a new line
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            className="max-h-28 min-h-9 flex-1 resize-none rounded-[18px] border border-transparent bg-fg/[0.07] px-3.5 py-2 text-sm leading-5 text-fg outline-none transition-colors [field-sizing:content] placeholder:text-fg-subtle focus:border-accent/50 focus-visible:outline-none!"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent transition-[transform,opacity] hover:bg-accent-soft active:scale-90 disabled:opacity-35"
          >
            <Icon name="send" size={18} />
          </button>
        </form>
      )}
    </section>
  );
}

// Shown on hover (and keyboard focus) beside a message
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Delete message"
      title="Delete for everyone"
      className="mb-1 shrink-0 rounded-full p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/msg:opacity-100"
    >
      <Icon name="trash" size={12} />
    </button>
  );
}

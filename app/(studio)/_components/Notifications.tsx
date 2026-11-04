"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, inputClass, textareaClass } from "@/app/components/ui/primitives";
import { canSendNotifications } from "@/lib/auth/roles";
import { errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import { BODY_MAX, TITLE_MAX, type PublicNotification } from "@/lib/notifications-shared";
import RecipientPicker, { type Audience } from "./RecipientPicker";
import { useStudio } from "./StudioProvider";

// --------------------------------------------------
// NOTIFICATIONS (top bar bell)
//
// Everyone: a bell with the unread count; its panel lists
// recent messages, and new ones pop up once at the bottom
// right. Opening the panel marks them read.
// Super admin: also sends a message to everyone or to
// chosen users, sees who each went to, and can delete one
// (lib/notifications.ts).
// Checked every 30 s while the tab is visible.
// --------------------------------------------------

const POLL_MS = 30_000;
// Pop-ups at a time
const MAX_TOASTS = 3;

type List = { notifications: PublicNotification[]; unread: number };

function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const markRead = (read: string[] | "all") =>
  fetchJson("/api/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ read }),
  }).catch((error) => logRequestError(error, "Mark notifications read"));

export default function Notifications() {
  const { currentUser } = useStudio();
  const canSend = canSendNotifications(currentUser);
  const [list, setList] = useState<List | null>(null);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<PublicNotification[]>([]);
  // Super admin: the send form is showing
  const [composing, setComposing] = useState(false);
  // `open`, for the poll (outside React's render)
  const openRef = useRef(false);

  // Closing, however it happens: messages count as read
  // (their dots go), the send form folds away
  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setComposing(false);
    setList((current) =>
      current ? { ...current, notifications: current.notifications.map((item) => ({ ...item, read: true })) } : current,
    );
  }, []);
  // Popped up already in this tab
  const shown = useRef(new Set<string>());
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Where the panel sits: under the bell, right-aligned
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const load = useCallback(async () => {
    try {
      let next = await fetchJson<List>("/api/notifications");
      // Arrived while the panel is open: read now (it shows
      // them), and no pop-up
      const seenNow = openRef.current ? next.notifications.filter((item) => !item.read).map((item) => item.id) : [];
      if (seenNow.length) {
        void markRead(seenNow);
        seenNow.forEach((id) => shown.current.add(id));
        next = { ...next, unread: next.unread - seenNow.length };
      }
      setList(next);
      // Recalled or deleted since: their pop-ups go too
      const present = new Set(next.notifications.filter((item) => !item.recalled).map((item) => item.id));
      setToasts((current) => (current.every((item) => present.has(item.id)) ? current : current.filter((item) => present.has(item.id))));
      const fresh = next.notifications.filter((item) => !item.read && !shown.current.has(item.id));
      fresh.forEach((item) => shown.current.add(item.id));
      if (fresh.length) {
        setToasts((current) => [...fresh, ...current.filter((item) => !fresh.some((f) => f.id === item.id))].slice(0, MAX_TOASTS));
      }
    } catch (error) {
      logRequestError(error, "Load notifications");
    }
  }, []);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void load();
    };
    check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load]);

  // Outside click and Escape close the panel
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapper.current?.contains(target) || panel.current?.contains(target)) return;
      // Its own pop-overs live in <body> too (e.g. the user list)
      if (target instanceof Element && target.closest("[data-notifications-layer]")) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // The panel is in <body> (see below), so it follows the
  // bell when the window resizes
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = wrapper.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  function toggle() {
    if (open) return close();
    openRef.current = true;
    setOpen(true);
    setToasts([]);
    const unreadIds = list?.notifications.filter((item) => !item.read).map((item) => item.id) ?? [];
    if (list && unreadIds.length) {
      // Read on the server; the dots stay while it's open
      void markRead(unreadIds);
      setList({ ...list, unread: 0 });
    }
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((item) => item.id !== id));
    void markRead([id]);
    setList((current) =>
      current
        ? {
            unread: Math.max(0, current.unread - (current.notifications.some((item) => item.id === id && !item.read) ? 1 : 0)),
            notifications: current.notifications.map((item) => (item.id === id ? { ...item, read: true } : item)),
          }
        : current,
    );
  }

  async function recall(item: PublicNotification) {
    const who = item.to ? recipientsLabel(item.to) : "everyone";
    if (!window.confirm(`Recall “${item.title}”?\n\nIt disappears for ${who} within 30 seconds. You'll still see it here, marked Recalled.`)) {
      return;
    }
    try {
      await fetchJson(`/api/notifications/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recall: true }),
      });
      setList((current) =>
        current
          ? { ...current, notifications: current.notifications.map((other) => (other.id === item.id ? { ...other, recalled: true } : other)) }
          : current,
      );
    } catch (error) {
      window.alert(errorMessage(error, "Couldn't recall the notification"));
    }
  }

  async function remove(item: PublicNotification) {
    if (!window.confirm(`Delete “${item.title}” for good?${item.recalled ? "" : " It also disappears for everyone it went to."}`)) return;
    try {
      await fetchJson(`/api/notifications/${item.id}`, { method: "DELETE" });
      setList((current) =>
        current ? { ...current, notifications: current.notifications.filter((other) => other.id !== item.id) } : current,
      );
    } catch (error) {
      window.alert(errorMessage(error, "Couldn't delete the notification"));
    }
  }

  const unread = list?.unread ?? 0;
  const items = list?.notifications ?? [];

  return (
    <>
      <div ref={wrapper} className="relative">
        <Button
          size="sm"
          variant="ghost"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="relative"
        >
          <Icon name="bell" size={17} />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>

      </div>

      {/* In <body>, not the top bar: the bar's own frosted
          blur would keep this one from blurring the page
          behind (and pin it to the bar) */}
      {open && anchor && createPortal(
          <div
            ref={panel}
            id={panelId}
            role="region"
            aria-label="Notifications"
            style={{ top: anchor.top, right: anchor.right }}
            className="ui-menu glass fixed z-40 flex max-h-[min(80vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <p className="text-sm font-medium text-fg">
                Notifications
                {items.length > 0 && <span className="ml-2 text-xs font-normal text-fg-subtle">{items.length} recent</span>}
              </p>
              {canSend && (
                <Button
                  size="sm"
                  variant={composing ? "ghost" : "secondary"}
                  icon={composing ? "close" : "send"}
                  aria-expanded={composing}
                  onClick={() => setComposing((value) => !value)}
                >
                  {composing ? "Cancel" : "New message"}
                </Button>
              )}
            </div>

            {/* Folded away until wanted, so the messages get
                the room */}
            {canSend && composing && (
              <Compose
                selfId={currentUser.id}
                onSent={async () => {
                  setComposing(false);
                  await load();
                }}
              />
            )}

            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-fg-subtle">No notifications yet</li>
              )}
              {items.map((item) => (
                <li key={item.id} className={cx("group flex gap-3 px-4 py-3", item.recalled && "opacity-60")}>
                  <span
                    aria-hidden
                    className={cx(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      item.read ? "bg-transparent" : item.level === "important" ? "bg-danger" : "bg-accent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-start gap-2 text-sm font-medium text-fg">
                      <span className="min-w-0 flex-1 break-words">{item.title}</span>
                      {item.recalled && (
                        <span className="shrink-0 rounded-md bg-fg/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          Recalled
                        </span>
                      )}
                      {item.level === "important" && (
                        <span className="shrink-0 rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                          Important
                        </span>
                      )}
                    </p>
                    {item.body && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-fg-muted">{item.body}</p>
                    )}
                    <p className="mt-1.5 text-xs text-fg-subtle">
                      {item.from} · <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                      {item.to !== undefined && (
                        <span title={item.to ? item.to.join(", ") : undefined}> · To {recipientsLabel(item.to)}</span>
                      )}
                      {!item.read && <span className="sr-only"> · unread</span>}
                    </p>
                  </div>
                  {canSend && (
                    <span className="flex shrink-0 flex-col gap-0.5 self-start">
                      {!item.recalled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="undo"
                          aria-label={`Recall “${item.title}”`}
                          title="Recall: take it back from everyone it went to"
                          onClick={() => recall(item)}
                          className="opacity-60 hover:opacity-100"
                        />
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        aria-label={`Delete “${item.title}”`}
                        title="Delete for good"
                        onClick={() => remove(item)}
                        className="opacity-60 hover:opacity-100"
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
      )}

      {/* New messages pop up once. In <body>: the top bar's
          glass (backdrop-filter) would pin a fixed box to
          the bar instead of the window. */}
      {toasts.length > 0 && !open && createPortal(
        <div
          role="region"
          aria-label="New notifications"
          aria-live="polite"
          className="fixed bottom-24 right-5 z-50 flex w-[min(92vw,360px)] flex-col gap-2"
        >
          {toasts.map((item) => (
            <div key={item.id} className="ui-menu glass flex gap-3 rounded-2xl border px-4 py-3">
              <span className={cx("mt-0.5 shrink-0", item.level === "important" ? "text-danger" : "text-accent")}>
                <Icon name={item.level === "important" ? "alert" : "bell"} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-fg">{item.title}</p>
                {item.body && (
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5 text-fg-muted">
                    {item.body}
                  </p>
                )}
                <p className="mt-1 text-xs text-fg-subtle">From {item.from}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                aria-label="Dismiss"
                onClick={() => dismissToast(item.id)}
                className="shrink-0 self-start"
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// Super admin: send a message to everyone
// "everyone", "Alice", "Alice and Bob", "Alice, Bob +3"
function recipientsLabel(to: string[] | null) {
  if (!to) return "everyone";
  if (to.length <= 2) return to.join(" and ") || "no one";
  return `${to.slice(0, 2).join(", ")} +${to.length - 2}`;
}

function Compose({ onSent, selfId }: { onSent: () => Promise<void>; selfId: string }) {
  const [audience, setAudience] = useState<Audience>({ everyone: true });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || sending || noRecipients) return;
    setSending(true);
    setError("");
    setSent(false);
    try {
      await fetchJson("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          level: important ? "important" : "info",
          to: audience.everyone ? "everyone" : audience.users.map((user) => user.id),
        }),
      });
      setTitle("");
      setBody("");
      setImportant(false);
      setAudience({ everyone: true });
      setSent(true);
      await onSent();
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the notification"));
    } finally {
      setSending(false);
    }
  }

  const noRecipients = !audience.everyone && audience.users.length === 0;
  const count = audience.everyone ? 0 : audience.users.length;

  return (
    <form onSubmit={send} className="ui-rise space-y-2 border-b border-line bg-fg/[0.03] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">Send a notification</p>
      <RecipientPicker
        value={audience}
        selfId={selfId}
        onChange={(next) => {
          setAudience(next);
          setSent(false);
        }}
      />
      <label htmlFor={titleId} className="sr-only">
        Title
      </label>
      <input
        id={titleId}
        value={title}
        maxLength={TITLE_MAX}
        onChange={(event) => {
          setTitle(event.target.value);
          setSent(false);
        }}
        placeholder="Title"
        // Opened on purpose: straight to typing
        autoFocus
        className={cx(inputClass, "h-9")}
      />
      <label htmlFor={bodyId} className="sr-only">
        Message
      </label>
      <textarea
        id={bodyId}
        value={body}
        maxLength={BODY_MAX}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Message (optional)"
        className={cx(textareaClass, "resize-none py-2")}
      />
      {error && <Alert>{error}</Alert>}
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={important} onChange={(event) => setImportant(event.target.checked)} />
          Important
        </label>
        <span className="flex items-center gap-2">
          {sent && <span className="text-xs text-fg-subtle" role="status">Sent</span>}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon="send"
            disabled={!title.trim() || sending || noRecipients}
            title={noRecipients ? "Choose at least one user" : undefined}
          >
            {sending ? "Sending…" : audience.everyone ? "Send to everyone" : `Send to ${count} user${count === 1 ? "" : "s"}`}
          </Button>
        </span>
      </div>
    </form>
  );
}

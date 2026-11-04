"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, cx } from "@/app/components/ui/primitives";
import { errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import { REPLY_MAX, type PublicNotification, type PublicThread } from "@/lib/notifications-shared";

// --------------------------------------------------
// REPLIES UNDER A NOTIFICATION (bell panel)
//
// A recipient sees their own private thread with the
// super admin and can reply. The super admin sees every
// thread (one per person who replied) and answers each.
// Opening it marks the other side's replies seen.
// --------------------------------------------------

function clock(iso: string) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function NotificationThread({
  item,
  isAdmin,
  onChanged,
}: {
  item: PublicNotification;
  isAdmin: boolean;
  // Counts changed (seen, or a reply sent)
  onChanged: () => void;
}) {
  const [threads, setThreads] = useState<PublicThread[] | null>(null);
  const [error, setError] = useState("");
  const url = `/api/notifications/${item.id}/replies`;

  // Bumped to load again (after sending)
  const [reloads, setReloads] = useState(0);

  // Loads the threads, again whenever the counts move (a
  // new reply arrived); state is only set in the callbacks
  const version = `${item.replies}:${item.unreadReplies}`;
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ threads: PublicThread[] }>(url)
      .then(async (data) => {
        if (cancelled) return;
        setThreads(data.threads);
        setError("");
        // Seen now: the bell's counts drop
        if (data.threads.some((thread) => thread.unread > 0)) {
          await fetchJson(url, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ seen: true }),
          });
          onChanged();
        }
      })
      .catch((err) => {
        logRequestError(err, "Load replies");
        if (!cancelled) setError(errorMessage(err, "Couldn't load replies"));
      });
    return () => {
      cancelled = true;
    };
  }, [url, onChanged, version, reloads]);

  async function send(body: string, to?: string) {
    await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, ...(to ? { to } : {}) }),
    });
    setReloads((count) => count + 1);
    onChanged();
  }

  const canReply = !item.recalled;

  return (
    <div className="ui-rise mt-2.5 space-y-3 rounded-xl border border-line bg-fg/[0.03] p-2.5">
      {error && <p className="px-1 text-xs text-danger">{error}</p>}
      {!threads && !error && <p className="px-1 text-xs text-fg-subtle">Loading replies…</p>}

      {threads && isAdmin && threads.length === 0 && (
        <p className="px-1 text-xs text-fg-subtle">No replies yet. You can answer once someone replies.</p>
      )}

      {threads?.map((thread) => (
        <section key={thread.userId} aria-label={isAdmin ? `Thread with ${thread.userName}` : "Your replies"} className="space-y-1.5">
          {isAdmin && (
            <p className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">{thread.userName}</p>
          )}
          <ol className="space-y-1.5">
            {thread.replies.map((reply) => (
              <li key={reply.id} className={cx("flex flex-col", reply.mine ? "items-end" : "items-start")}>
                <p
                  className={cx(
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm leading-5 shadow-[inset_0_1px_0_var(--glass-edge)]",
                    reply.mine ? "rounded-br-md bg-accent-soft text-fg" : "rounded-bl-md bg-fg/[0.07] text-fg",
                  )}
                >
                  {reply.body}
                </p>
                <span className="mt-0.5 px-1 text-[10px] text-fg-subtle">
                  {reply.mine ? "You" : reply.author} · <time dateTime={reply.createdAt}>{clock(reply.createdAt)}</time>
                </span>
              </li>
            ))}
          </ol>
          {isAdmin && canReply && (
            <Composer placeholder={`Answer ${thread.userName}…`} onSend={(body) => send(body, thread.userId)} />
          )}
        </section>
      ))}

      {!isAdmin && threads && canReply && (
        <Composer placeholder={`Reply to ${item.from}…`} hint="Only they see your reply" onSend={(body) => send(body)} autoFocus={threads.length === 0} />
      )}
    </div>
  );
}

function Composer({
  placeholder,
  hint,
  onSend,
  autoFocus,
}: {
  placeholder: string;
  hint?: string;
  onSend: (body: string) => Promise<void>;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      await onSend(text);
      setBody("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the reply"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="flex items-end gap-1.5 rounded-xl border border-line bg-sunken/60 p-1 transition-colors focus-within:border-accent">
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={id}
          ref={area}
          value={body}
          rows={1}
          maxLength={REPLY_MAX}
          placeholder={placeholder}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a new line
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 text-fg outline-none [field-sizing:content] placeholder:text-fg-subtle focus-visible:outline-none!"
        />
        <Button type="button" size="sm" variant="primary" icon="send" aria-label="Send reply" disabled={!body.trim() || sending} onClick={submit} />
      </div>
      {error ? (
        <p className="mt-1 px-1 text-xs text-danger">{error}</p>
      ) : (
        hint && <p className="mt-1 px-1 text-[10px] text-fg-subtle">{hint} · Enter to send, Shift+Enter for a new line</p>
      )}
    </div>
  );
}

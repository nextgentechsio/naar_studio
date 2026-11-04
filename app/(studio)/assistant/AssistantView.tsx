"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { errorMessage, fetchJson, logRequestError } from "@/lib/client/http";
import { safeFileName, uploadToBlob } from "@/lib/client/upload";
import {
  ASSISTANT_MODEL_LABEL,
  ATTACHMENT_TYPES,
  assistantFolder,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  PROMPT_MAX,
  TOOL_LABELS,
  type Attachment,
  type ChatDetail,
  type ChatPart,
  type ChatSummary,
  type ChatTurn,
  type StreamEvent,
} from "@/lib/assistant/shared";
import { useStudio } from "../_components/StudioProvider";
import Markdown from "./Markdown";

// --------------------------------------------------
// ASSISTANT (claude.ai-style chat)
//
// Your chats on the left; the conversation in the middle,
// Claude's reply streaming in as it's written, with its
// thinking and tool activity folded into small rows; the
// message box at the bottom (Enter sends, Shift+Enter is
// a new line, Stop ends a reply). Read only for now: it
// looks things up and plans, it doesn't start runs.
// The open chat is in the address (?chat=…).
// --------------------------------------------------

const SUGGESTIONS = [
  "Which model should I use for a 9:16 product video?",
  "What would a 5-second 1080p Seedance 2.5 video cost?",
  "Show my last 5 successful videos",
  "What elements do I have saved?",
];

const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

function readChatParam() {
  return new URLSearchParams(window.location.search).get("chat");
}

function writeChatParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("chat", id);
  else url.searchParams.delete("chat");
  window.history.replaceState(null, "", url);
}

// Applies one streamed event to the reply being shown
function applyEvent(parts: ChatPart[], event: StreamEvent): ChatPart[] {
  const next = [...parts];
  const last = next[next.length - 1];
  switch (event.type) {
    case "text":
      if (last?.kind === "text") next[next.length - 1] = { ...last, text: last.text + event.text };
      else next.push({ kind: "text", text: event.text });
      return next;
    case "thinking":
      if (last?.kind === "thinking") next[next.length - 1] = { ...last, text: last.text + event.text };
      else next.push({ kind: "thinking", text: event.text });
      return next;
    case "tool":
      next.push({ kind: "tool", id: event.id, name: event.name, input: event.input });
      return next;
    case "tool_result":
      return next.map((part) =>
        part.kind === "tool" && part.id === event.id ? { ...part, result: { ok: event.ok, summary: event.summary } } : part,
      );
    case "notice":
      next.push({ kind: "notice", text: event.text });
      return next;
    default:
      return next;
  }
}

export default function AssistantView() {
  const { currentUser } = useStudio();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const loadChats = useCallback((openFromUrl: boolean) => {
    fetchJson<{ chats: ChatSummary[]; configured: boolean }>("/api/assistant/chats")
      .then((data) => {
        setChats(data.chats);
        setConfigured(data.configured);
        // The chat named in the address (?chat=…)
        const fromUrl = openFromUrl ? readChatParam() : null;
        if (fromUrl) setActiveId(fromUrl);
      })
      .catch((err) => {
        logRequestError(err, "Load assistant chats");
        setError(errorMessage(err, "Couldn't load your chats"));
      });
  }, []);

  useEffect(() => {
    loadChats(true);
  }, [loadChats]);

  // Opening a chat loads it (not while its reply streams)
  useEffect(() => {
    if (!activeId || chat?.id === activeId) return;
    let cancelled = false;
    fetchJson<{ chat: ChatDetail }>(`/api/assistant/chats/${activeId}`)
      .then((data) => {
        if (!cancelled) setChat(data.chat);
      })
      .catch((err) => {
        logRequestError(err, "Open assistant chat");
        if (!cancelled) {
          setError(errorMessage(err, "Couldn't open that chat"));
          setActiveId(null);
          writeChatParam(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, chat?.id]);

  function open(id: string | null) {
    if (streaming) return;
    setError("");
    setSidebar(false);
    if (id !== activeId) setChat(null);
    setActiveId(id);
    writeChatParam(id);
  }

  async function send(text: string, attachments: Attachment[] = []) {
    const message = text.trim();
    if ((!message && !attachments.length) || streaming) return;
    setError("");

    // A first message starts a chat
    let current = chat;
    if (!current) {
      try {
        const { chat: created } = await fetchJson<{ chat: ChatSummary }>("/api/assistant/chats", { method: "POST" });
        current = { ...created, turns: [] };
        setChats((list) => [created, ...(list ?? [])]);
        setActiveId(created.id);
        writeChatParam(created.id);
      } catch (err) {
        setError(errorMessage(err, "Couldn't start a chat"));
        return;
      }
    }

    const now = new Date().toISOString();
    const userTurn: ChatTurn = {
      role: "user",
      parts: [
        ...attachments.map((file): ChatPart => ({ kind: "attachment", ...file })),
        ...(message ? [{ kind: "user", text: message } as ChatPart] : []),
      ],
      createdAt: now,
    };
    const replyTurn: ChatTurn = { role: "assistant", parts: [], createdAt: now };
    let parts: ChatPart[] = [];
    const base = current;
    const show = () => setChat({ ...base, turns: [...base.turns, userTurn, { ...replyTurn, parts }] });
    show();

    const controller = new AbortController();
    abort.current = controller;
    setStreaming(true);
    try {
      const response = await fetch(`/api/assistant/chats/${base.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message, attachments: attachments.map((file) => file.url) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Couldn't send (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const event = JSON.parse(chunk.slice(6)) as StreamEvent;
          if (event.type === "error") {
            setError(event.message);
          } else if (event.type === "done") {
            setChats((list) =>
              (list ?? []).map((item) =>
                item.id === base.id ? { ...item, title: event.title || item.title, costUsd: event.chatCostUsd, updatedAt: new Date().toISOString() } : item,
              ),
            );
            base.costUsd = event.chatCostUsd;
            if (event.title) base.title = event.title;
          } else {
            parts = applyEvent(parts, event);
          }
        }
        show();
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err, "Couldn't send the message"));
      else parts = applyEvent(parts, { type: "notice", text: "Stopped" });
      show();
    } finally {
      abort.current = null;
      setStreaming(false);
      // Newest first in the list
      setChats((list) => {
        if (!list) return list;
        const item = list.find((entry) => entry.id === base.id);
        return item ? [item, ...list.filter((entry) => entry.id !== base.id)] : list;
      });
    }
  }

  async function rename(item: ChatSummary) {
    const title = window.prompt("Rename chat", item.title)?.trim();
    if (!title || title === item.title) return;
    try {
      const { chat: renamed } = await fetchJson<{ chat: ChatSummary }>(`/api/assistant/chats/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setChats((list) => (list ?? []).map((entry) => (entry.id === item.id ? renamed : entry)));
      setChat((current) => (current?.id === item.id ? { ...current, title: renamed.title } : current));
    } catch (err) {
      setError(errorMessage(err, "Couldn't rename it"));
    }
  }

  async function remove(item: ChatSummary) {
    if (!window.confirm(`Delete “${item.title}”? This can't be undone.`)) return;
    try {
      await fetchJson(`/api/assistant/chats/${item.id}`, { method: "DELETE" });
      setChats((list) => (list ?? []).filter((entry) => entry.id !== item.id));
      if (activeId === item.id) open(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete it"));
    }
  }

  const firstName = currentUser.name.split(" ")[0];
  const loadingChat = Boolean(activeId) && chat?.id !== activeId;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] min-h-[520px] lg:-mx-6">
      {/* Chats */}
      <aside
        className={cx(
          "z-20 w-72 shrink-0 flex-col border-r border-line bg-surface/60 glass-soft",
          sidebar ? "fixed inset-y-14 left-0 flex lg:static" : "hidden lg:flex",
        )}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={() => open(null)}
            disabled={streaming}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-raised disabled:opacity-50"
          >
            <Icon name="edit" size={16} />
            New chat
          </button>
        </div>
        <p className="px-4 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">Recent</p>
        <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
          {chats?.length === 0 && <p className="px-2 py-3 text-xs text-fg-subtle">Your chats will show here.</p>}
          <ul className="space-y-0.5">
            {chats?.map((item) => (
              <li key={item.id} className="group relative">
                <button
                  type="button"
                  onClick={() => open(item.id)}
                  aria-current={item.id === activeId ? "page" : undefined}
                  className={cx(
                    "w-full truncate rounded-lg py-2 pl-3 pr-16 text-left text-sm transition-colors",
                    item.id === activeId ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-raised hover:text-fg",
                  )}
                  title={item.title}
                >
                  {item.title}
                </button>
                <span className="absolute inset-y-0 right-1 hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
                  <button type="button" onClick={() => rename(item)} aria-label={`Rename “${item.title}”`} className="rounded-md p-1.5 text-fg-subtle hover:bg-fg/[0.08] hover:text-fg">
                    <Icon name="edit" size={13} />
                  </button>
                  <button type="button" onClick={() => remove(item)} aria-label={`Delete “${item.title}”`} className="rounded-md p-1.5 text-fg-subtle hover:bg-fg/[0.08] hover:text-danger">
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Conversation */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={() => setSidebar((value) => !value)}
            aria-label="Chats"
            aria-expanded={sidebar}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-raised lg:hidden"
          >
            <Icon name="menu" size={18} />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{chat?.title ?? ""}</p>
          {chat && chat.costUsd > 0 && (
            <span className="shrink-0 font-mono text-[11px] text-fg-subtle" title="What this chat's Claude usage has cost">
              {money(chat.costUsd)}
            </span>
          )}
        </header>

        {!configured && (
          <div className="mx-auto mt-2 w-full max-w-3xl px-4">
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg">
              The assistant isn&apos;t set up yet. An admin needs to add <code className="font-mono">ANTHROPIC_API_KEY</code> to the server&apos;s environment.
            </p>
          </div>
        )}

        {chat && chat.turns.length > 0 ? (
          <Conversation turns={chat.turns} streaming={streaming} />
        ) : loadingChat ? (
          <p className="flex flex-1 items-center justify-center text-sm text-fg-subtle">Loading…</p>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="wand" size={24} />
            </span>
            <h1 className="text-center text-2xl font-semibold tracking-tight text-fg sm:text-3xl">What are we making today, {firstName}?</h1>
            <p className="mt-2 max-w-md text-center text-sm text-fg-muted">
              Ask about models, settings and prices, find past runs and elements, or plan a shoot. It looks things up for you; running is coming next.
            </p>
            <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!configured || streaming}
                  onClick={() => send(suggestion)}
                  className="rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Right padding: clear of the floating chat button */}
        <div className="mx-auto w-full max-w-3xl pb-4 pl-4 pr-[84px]">
          {error && (
            <p role="alert" className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Composer
            disabled={!configured || loadingChat}
            streaming={streaming}
            onSend={send}
            userId={currentUser.id}
            onStop={() => abort.current?.abort()}
            autoFocusKey={activeId ?? "new"}
          />
          <p className="mt-2 text-center text-[11px] text-fg-subtle">
            {ASSISTANT_MODEL_LABEL} · Looks things up and plans; it doesn&apos;t start runs yet · It can make mistakes, so check prices before running.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------- The conversation ----------

function Conversation({ turns, streaming }: { turns: ChatTurn[]; streaming: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [turns]);

  return (
    <div
      ref={scroller}
      onScroll={() => {
        const box = scroller.current;
        if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        {turns.map((turn, index) => {
          const last = index === turns.length - 1;
          return turn.role === "user" ? (
            <div key={index} className="flex flex-col items-end gap-2">
              <Attachments files={turn.parts.filter((part): part is Extract<ChatPart, { kind: "attachment" }> => part.kind === "attachment")} />
              {turn.parts.map((part, partIndex) =>
                part.kind === "user" ? (
                  <p key={partIndex} className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-fg/[0.07] px-4 py-2.5 text-[15px] leading-7 text-fg">
                    {part.text}
                  </p>
                ) : null,
              )}
            </div>
          ) : (
            <div key={index} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon name="wand" size={15} />
              </span>
              <div className="min-w-0 flex-1 space-y-2 text-[15px] text-fg">
                {turn.parts.map((part, partIndex) => (
                  <Part key={partIndex} part={part} live={last && streaming && partIndex === turn.parts.length - 1} />
                ))}
                {last && streaming && turn.parts.length === 0 && <Dots />}
                {last && streaming && turn.parts.length > 0 && turn.parts[turn.parts.length - 1].kind === "tool" && <Dots />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Files sent with a message: images as thumbnails, PDFs
// as named chips; each opens in a new tab
function Attachments({ files }: { files: Attachment[] }) {
  if (!files.length) return null;
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
      {files.map((file) =>
        file.type === "image" ? (
          <a key={file.url} href={file.url} target="_blank" rel="noreferrer noopener" title={file.name} className="block overflow-hidden rounded-xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={file.url} alt={file.name} className="h-32 w-auto max-w-56 object-cover" />
          </a>
        ) : (
          <a
            key={file.url}
            href={file.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex max-w-60 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg hover:bg-raised"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <Icon name="file" size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{file.name}</span>
              <span className="block text-[11px] text-fg-subtle">PDF</span>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

function Dots() {
  return (
    <span aria-label="Writing" className="inline-flex gap-1 py-2">
      {[0, 1, 2].map((dot) => (
        <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-subtle" style={{ animationDelay: `${dot * 150}ms` }} />
      ))}
    </span>
  );
}

function Part({ part, live }: { part: ChatPart; live: boolean }) {
  const [open, setOpen] = useState(false);

  if (part.kind === "text") return <Markdown text={part.text} />;

  if (part.kind === "notice") {
    return <p className="text-xs italic text-fg-subtle">{part.text}</p>;
  }

  if (part.kind === "thinking") {
    return (
      <div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle hover:text-fg-muted">
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
          {live ? "Thinking…" : "Thought it through"}
        </button>
        {open && <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-line pl-3 text-sm italic leading-6 text-fg-muted">{part.text}</p>}
      </div>
    );
  }

  if (part.kind === "tool") {
    const label = TOOL_LABELS[part.name] ?? part.name;
    return (
      <div className="text-xs">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-fg-muted transition-colors hover:text-fg"
        >
          <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", !part.result ? "animate-pulse bg-accent" : part.result.ok ? "bg-success" : "bg-danger")} />
          <span className="truncate">
            {label}
            {part.result ? ` · ${part.result.summary}` : "…"}
          </span>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
        </button>
        {open && (
          <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-line bg-sunken p-2.5 font-mono text-[11px] leading-5 text-fg-muted [scrollbar-width:thin]">
            {JSON.stringify(part.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return null;
}

// ---------- The message box ----------

type Pending = {
  key: string;
  file: File;
  type: "image" | "pdf";
  // Local preview (images), freed when it's removed
  preview: string | null;
  progress: number | null;
  url?: string;
  error?: string;
};

const sizeLabel = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

// A reason the file can't be attached, or null
function attachProblem(file: File): string | null {
  if (!ATTACHMENT_TYPES.includes(file.type)) return `${file.name}: only images (PNG, JPEG, WebP, GIF) and PDFs`;
  const max = file.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  return file.size > max ? `${file.name} is over ${sizeLabel(max)}` : null;
}

function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  autoFocusKey,
  userId,
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  autoFocusKey: string;
  userId: string;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    area.current?.focus();
  }, [autoFocusKey]);

  const update = (key: string, patch: Partial<Pending>) =>
    setFiles((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  // Each file uploads as soon as it's added
  function add(list: FileList | File[]) {
    if (disabled) return;
    setNotice("");
    const room = MAX_ATTACHMENTS - files.length;
    const incoming = [...list];
    if (incoming.length > room) setNotice(`Up to ${MAX_ATTACHMENTS} files per message`);

    for (const file of incoming.slice(0, Math.max(0, room))) {
      const problem = attachProblem(file);
      if (problem) {
        setNotice(problem);
        continue;
      }
      const item: Pending = {
        key: `${Date.now()}-${Math.random()}`,
        file,
        type: file.type === "application/pdf" ? "pdf" : "image",
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        progress: 0,
      };
      setFiles((current) => [...current, item]);
      uploadToBlob(`${assistantFolder(userId)}${safeFileName(file)}`, "/api/assistant/upload", file, (percent) =>
        update(item.key, { progress: percent }),
      )
        .then((url) => update(item.key, { url, progress: 100 }))
        .catch((err) => update(item.key, { error: errorMessage(err, "Upload failed") }));
    }
  }

  function remove(key: string) {
    setFiles((current) => {
      const item = current.find((entry) => entry.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return current.filter((entry) => entry.key !== key);
    });
  }

  const uploading = files.some((item) => !item.url && !item.error);
  const failed = files.some((item) => item.error);
  const ready = (draft.trim() || files.length > 0) && !uploading && !failed && !streaming && !disabled;

  function submit() {
    if (!ready) return;
    onSend(
      draft,
      files.map((item) => ({ url: item.url!, type: item.type, name: item.file.name })),
    );
    setDraft("");
    setNotice("");
    // The sent thumbnails now show the stored copies
    files.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setFiles([]);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) add(event.dataTransfer.files);
      }}
      className={cx(
        "glass relative rounded-2xl border p-2 shadow-sm transition-shadow focus-within:shadow-[0_0_0_1.5px_var(--accent)]",
        dragging && "shadow-[0_0_0_2px_var(--accent)]",
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-accent-soft/80 text-sm font-medium text-accent">
          Drop images or PDFs to attach
        </div>
      )}

      {files.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-1 pb-1 pt-1">
          {files.map((item) => (
            <li key={item.key} className="group relative">
              {item.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt={item.file.name} className="h-16 w-16 rounded-xl border border-line object-cover" />
              ) : (
                <span className="flex h-16 w-44 items-center gap-2 rounded-xl border border-line bg-surface px-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                    <Icon name="file" size={16} />
                  </span>
                  <span className="min-w-0 text-xs">
                    <span className="block truncate font-medium text-fg">{item.file.name}</span>
                    <span className="text-fg-subtle">PDF</span>
                  </span>
                </span>
              )}
              {!item.url && !item.error && (
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 font-mono text-[11px] font-semibold text-white">
                  {item.progress === null ? "…" : `${Math.round(item.progress)}%`}
                </span>
              )}
              {item.error && (
                <span title={item.error} className="absolute inset-0 flex items-center justify-center rounded-xl bg-danger/80 px-1 text-center text-[10px] font-semibold text-white">
                  Failed
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(item.key)}
                aria-label={`Remove ${item.file.name}`}
                className="glass absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-fg-muted hover:text-fg"
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor={id} className="sr-only">
        Message the assistant
      </label>
      <textarea
        id={id}
        ref={area}
        rows={1}
        value={draft}
        disabled={disabled}
        maxLength={PROMPT_MAX}
        placeholder={disabled ? "The assistant isn't set up yet" : "Ask about models, prices, your runs…"}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          // Pasted screenshots and images attach
          const pasted = [...event.clipboardData.files];
          if (pasted.length) {
            event.preventDefault();
            add(pasted);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-60 min-h-12 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 text-fg outline-none [field-sizing:content] placeholder:text-fg-subtle focus-visible:outline-none! disabled:opacity-60"
      />
      <div className="flex items-center gap-2 px-1">
        <input
          ref={picker}
          type="file"
          multiple
          accept={ATTACHMENT_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={disabled || files.length >= MAX_ATTACHMENTS}
          aria-label="Attach images or PDFs"
          title="Attach images or PDFs (or drop / paste them)"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-raised hover:text-fg disabled:opacity-40"
        >
          <Icon name="paperclip" size={18} />
        </button>
        <span role="status" className="min-w-0 flex-1 truncate text-xs text-danger">
          {notice || (failed ? "Remove the failed file to send" : "")}
        </span>
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            title="Stop"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-fg text-canvas transition-transform active:scale-95"
          >
            <span className="h-3 w-3 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={uploading ? "Uploading…" : "Send"}
            disabled={!ready}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-on-accent transition-[transform,opacity] active:scale-95 disabled:opacity-30"
          >
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </form>
  );
}

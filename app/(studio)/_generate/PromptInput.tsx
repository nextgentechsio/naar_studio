"use client";

import Link from "next/link";
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useGenerate } from "@/app/(studio)/_components/GenerateProvider";
import ElementDialog from "@/app/(studio)/elements/ElementDialog";
import { useElements, type Element } from "@/lib/client/elements";
import { mentionedElements } from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { cx } from "@/app/components/ui/primitives";
import { fileKind, StableTextArea, type SchemaProperty } from "./fields";

// --------------------------------------------------
// PROMPT WITH @ELEMENTS
//
// Typing @ lists the user's elements (lib/elements.ts)
// at the caret, or offers to create one with the name
// typed so far. Picking one writes @name into the prompt
// and puts its reference images in the model's image
// input. Mentions are highlighted in the text, and the
// elements in use show as chips under it (removing one
// takes its images out too). When the run is sent, @name
// becomes the name and description
// (lib/element-mentions.ts).
// --------------------------------------------------

const MAX_SHOWN = 8;
const MENU_WIDTH = 304;

// "@ma" just before the caret → query "ma"
const TYPING = /(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{0,40})$/u;

// Splits text into plain runs and @mentions
const MENTION_SPLIT = /((?:^|(?<=[^\p{L}\p{N}_@-]))@[\p{L}\p{N}_-]{1,40})/u;

// Where the list is open: the "@" and the caret
type Mention = { start: number; end: number; query: string; top: number; left: number };

// The caret's position inside the text area, from a copy
// of it with the same text and styles
function caretPoint(area: HTMLTextAreaElement, index: number) {
  const mirror = document.createElement("div");
  const style = getComputedStyle(area);

  for (const name of [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight",
    "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "tabSize",
  ] as const) {
    mirror.style[name] = style[name];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = area.value.slice(0, index);

  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const point = {
    top: marker.offsetTop - area.scrollTop + (parseFloat(style.lineHeight) || 20),
    left: marker.offsetLeft - area.scrollLeft,
  };
  mirror.remove();

  return point;
}

// The model's image input, a list field first
function imageField(schema: Record<string, SchemaProperty>) {
  const fields = Object.entries(schema).filter(([key, field]) => fileKind(key, field) === "image");
  return (
    fields.find(([, field]) => field.type === "array") ??
    fields.find(([key]) => /image_urls|image_input|reference_images/.test(key)) ??
    fields[0]
  );
}

const takesList = ([key, field]: [string, SchemaProperty]) =>
  field.type === "array" || /image_urls|image_input|reference_images/.test(key);

// "Maya" with the typed part ("ay") emphasised
function highlight(text: string, query: string): ReactNode {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;

  return (
    <>
      {text.slice(0, at)}
      <span className="text-accent">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

export default function PromptInput({
  value,
  onChange,
  className,
  ...props
}: {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const { schema, inputs, updateInput } = useGenerate();
  const { elements } = useElements();

  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  // Creating an element from the list: where it goes
  const [creating, setCreating] = useState<Mention | null>(null);

  const known = new Set((elements ?? []).map((element) => element.name.toLowerCase()));
  const inUse = mentionedElements(value, elements ?? []);

  const query = mention?.query ?? "";
  const lower = query.toLowerCase();
  const matches = (elements ?? [])
    .filter((element) => element.name.toLowerCase().includes(lower))
    // Names starting with what's typed first
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(lower)) - Number(!b.name.toLowerCase().startsWith(lower))
    )
    .slice(0, MAX_SHOWN);
  // The last option creates one, unless the name exists
  const canCreate = !known.has(lower);
  const optionCount = matches.length + (canCreate ? 1 : 0);

  const listId = `${props.id}-elements`;

  // Opens, moves or closes the list for the text before
  // the caret
  function track() {
    const node = area.current;
    if (!node || node.selectionStart !== node.selectionEnd) return setMention(null);

    const caret = node.selectionStart;
    const typed = node.value.slice(0, caret).match(TYPING);
    if (!typed) return setMention(null);

    const start = caret - typed[2].length - 1;
    if (mention?.start !== start || mention.query !== typed[2]) setActive(0);

    const point = caretPoint(node, start);
    const wrapper = node.parentElement!;
    setMention({
      start,
      end: caret,
      query: typed[2],
      top: wrapper.offsetTop + point.top + 6,
      left: wrapper.offsetLeft + Math.max(0, Math.min(point.left, node.clientWidth - MENU_WIDTH)),
    });
  }

  function setText(next: string, caret: number) {
    const node = area.current;
    if (!node) return;

    node.value = next;
    node.focus();
    node.setSelectionRange(caret, caret);
    onChange(next);
  }

  function attach(element: Element) {
    const field = imageField(schema);

    if (!field) {
      setNote(`This model takes no images, so only @${element.name}'s name and description are sent.`);
      return;
    }

    const [key] = field;
    const current = inputs[key];

    if (!takesList(field)) {
      updateInput(key, element.images[0]);
      setNote(
        element.images.length > 1 ? `This model takes one image, so @${element.name}'s cover was added.` : ""
      );
      return;
    }

    const list = Array.isArray(current) ? current.map(String) : typeof current === "string" && current ? [current] : [];
    updateInput(key, [...list, ...element.images.filter((url) => !list.includes(url))]);
    setNote("");
  }

  // Writes @name over what was typed and adds its images
  function pick(element: Element, at: Mention | null = mention) {
    const node = area.current;
    if (!node || !at) return;

    const text = `@${element.name} `;
    const next = node.value.slice(0, at.start) + text + node.value.slice(at.end).replace(/^ /, "");

    setText(next, at.start + text.length);
    setMention(null);
    attach(element);
  }

  // Takes a mention out of the prompt, with the images
  // only it brought
  function detach(element: Element) {
    const node = area.current;
    if (!node) return;

    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@-])@${element.name.replace(/[-]/g, "\\-")}(?![\\p{L}\\p{N}_-]) ?`, "giu");
    const next = node.value.replace(pattern, "$1");
    setText(next, next.length);

    const field = imageField(schema);
    if (!field) return;

    const [key] = field;
    const others = new Set(
      mentionedElements(next, elements ?? []).flatMap((item) => item.images)
    );
    const current = inputs[key];

    if (Array.isArray(current)) {
      updateInput(key, current.filter((url) => !element.images.includes(String(url)) || others.has(String(url))));
    } else if (typeof current === "string" && element.images.includes(current) && !others.has(current)) {
      updateInput(key, "");
    }
    setNote("");
  }

  function startCreate() {
    if (!mention) return;
    setCreating(mention);
    setMention(null);
  }

  function choose(index: number) {
    if (index < matches.length) pick(matches[index]);
    else startCreate();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention) return;

    if (event.key === "Escape") {
      // Only the list closes, not a dialog around it
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setMention(null);
      return;
    }

    if (!optionCount || elements === null) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + optionCount) % optionCount);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(Math.min(active, optionCount - 1));
    }
  }

  const open = mention !== null;

  return (
    <>
      {/* Mentions are drawn behind the (transparent) text
          area, in the same place as its text */}
      <div className="relative flex min-h-0 flex-1 flex-col rounded-lg bg-sunken">
        <div
          ref={backdrop}
          aria-hidden
          className={cx(
            className,
            "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words border-transparent! bg-transparent! text-transparent"
          )}
        >
          {value.split(MENTION_SPLIT).map((part, index) =>
            part.startsWith("@") && known.has(part.slice(1).toLowerCase()) ? (
              <mark key={index} className="rounded-[4px] bg-accent-soft text-transparent shadow-[0_0_0_2px_var(--accent-soft)]">
                {part}
              </mark>
            ) : (
              <Fragment key={index}>{part}</Fragment>
            )
          )}
          {/* A trailing line break needs something after it */}
          {"​"}
        </div>

        <StableTextArea
          {...props}
          ref={area}
          value={value}
          className={cx(className, "relative bg-transparent!")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && optionCount ? `${listId}-${active}` : undefined}
          onChange={(next) => {
            onChange(next);
            track();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) track();
          }}
          onClick={track}
          onScroll={(event) => {
            if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
            setMention(null);
          }}
          onBlur={() => setMention(null)}
        />
      </div>

      {/* Elements in this prompt */}
      {inUse.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Elements in this prompt">
          {inUse.map((element) => (
            <li
              key={element.id}
              className="ui-menu glass flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 text-xs"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={element.images[0]} alt="" className="h-5 w-5 rounded-full object-cover" />
              <span className="font-medium text-fg">@{element.name}</span>
              <span className="text-fg-subtle">· {element.images.length} img</span>
              <button
                type="button"
                aria-label={`Remove @${element.name} and its images`}
                title="Remove from prompt"
                onClick={() => detach(element)}
                className="flex h-4 w-4 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-raised hover:text-fg"
              >
                <Icon name="close" size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="ui-rise flex items-center gap-1.5 text-xs text-fg-subtle" role="status">
          <Icon name="info" size={12} />
          {note}
        </p>
      )}

      {open && (
        <div
          className="ui-menu glass-menu absolute z-30 overflow-hidden rounded-xl border"
          style={{ top: mention.top, left: mention.left, width: MENU_WIDTH }}
          // Keep focus (and the caret) in the text area
          onMouseDown={(event) => event.preventDefault()}
        >
          <p className="flex items-center justify-between px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
            Elements
            <Link href="/elements" className="normal-case tracking-normal text-fg-subtle hover:text-fg">
              Manage
            </Link>
          </p>

          {elements === null ? (
            <ul className="space-y-1 px-2 pb-2">
              {[0, 1].map((index) => (
                <li key={index} className="flex items-center gap-2.5 px-1 py-1">
                  <span className="ui-skeleton h-9 w-9 rounded-lg" />
                  <span className="ui-skeleton h-3 w-24 rounded" />
                </li>
              ))}
            </ul>
          ) : (
            <ul id={listId} role="listbox" aria-label="Elements" className="max-h-72 overflow-y-auto px-1.5 pb-1.5">
              {matches.map((element, index) => (
                <li
                  key={element.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(element)}
                  className={cx(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors",
                    index === active && "bg-raised"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={element.images[0]} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-black object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">@{highlight(element.name, query)}</span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {element.description || `${element.images.length} image${element.images.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  {index === active && (
                    <kbd className="rounded border border-line px-1 text-[10px] text-fg-subtle">↵</kbd>
                  )}
                </li>
              ))}

              {canCreate && (
                <li
                  id={`${listId}-${matches.length}`}
                  role="option"
                  aria-selected={active === matches.length}
                  onMouseEnter={() => setActive(matches.length)}
                  onClick={startCreate}
                  className={cx(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors",
                    matches.length > 0 && "mt-1",
                    active === matches.length && "bg-raised"
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-accent">
                    <Icon name="at" size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {query ? <>Create <span className="text-accent">@{query}</span></> : "New element"}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {elements.length ? "Save a new character or object" : "You have no elements yet"}
                    </span>
                  </span>
                </li>
              )}
            </ul>
          )}

          <p className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">
            <span>↑↓ move</span>
            <span>↵ add</span>
            <span>esc close</span>
          </p>
        </div>
      )}

      {creating && (
        <ElementDialog
          element={null}
          initialName={creating.query}
          onClose={() => setCreating(null)}
          onSaved={(element) => {
            // Put it where @ was typed, if the text there
            // hasn't changed meanwhile
            const node = area.current;
            const still = node?.value.slice(creating.start, creating.end) === `@${creating.query}`;
            const at = still
              ? creating
              : { ...creating, start: node?.value.length ?? 0, end: node?.value.length ?? 0 };
            pick(element, at);
          }}
        />
      )}
    </>
  );
}

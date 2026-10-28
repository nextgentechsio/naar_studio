"use client";

import { useState } from "react";
import { addFileToElement, useElements, type Element } from "@/lib/client/elements";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { saveRunToLibrary } from "@/lib/client/library";
import { elementMedia, type ElementMediaKind } from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, cx, Spinner } from "@/app/components/ui/primitives";
import ElementCover from "./ElementCover";
import ElementDialog from "./ElementDialog";

// --------------------------------------------------
// ADD A GENERATED RESULT TO AN ELEMENT (window)
//
// From a run's result (Generate page, History): the
// image, video or audio is copied into the user's library
// (elements are made of library files), then added to an
// existing element or starts a new one in the usual
// element flow.
// --------------------------------------------------

export default function AddToElementDialog({
  generationId,
  kind,
  preview,
  onClose,
}: {
  generationId: string;
  kind: ElementMediaKind;
  // What to show while choosing (the result's link)
  preview: string;
  onClose: () => void;
}) {
  const { elements } = useElements();
  // The element being added to, or "new"
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Element | null>(null);
  // The copied file, once a new element is being made
  const [creating, setCreating] = useState<string | null>(null);

  const media = elementMedia(kind);

  async function addTo(target: Element | "new", close: () => void) {
    setBusy(target === "new" ? "new" : target.id);
    setError("");
    try {
      const file = await saveRunToLibrary(generationId);
      if (target === "new") {
        setCreating(file.url);
        return;
      }
      setAdded(await addFileToElement(target, kind, file.url));
      setTimeout(close, 1200);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, `Couldn't add the ${media.one}. Please try again.`));
    } finally {
      setBusy(null);
    }
  }

  // A new element: the usual flow, starting with the file
  if (creating) {
    return <ElementDialog element={null} initial={{ [media.list]: [creating] }} onClose={onClose} />;
  }

  return (
    <Modal title="Add to element" subtitle={`Reuse this ${media.one} with @name in later prompts.`} onClose={onClose}>
      {(close) => (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-line p-5">
          <div className="flex items-center gap-3">
            <ElementCover
              element={{ images: kind === "image" ? [preview] : [], videos: kind === "video" ? [preview] : [] }}
              iconSize={22}
              className="h-16 w-16 shrink-0 rounded-lg border border-line"
            />
            <p className="text-xs text-fg-subtle">
              The {media.one} is copied into your library, then added to the element.
            </p>
          </div>

          {error && <Alert>{error}</Alert>}

          {added ? (
            <p role="status" className="ui-rise flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-fg">
              <Icon name="check" size={16} className="text-accent" />
              Added to <span className="font-semibold">@{added.name}</span>
            </p>
          ) : (
            <ul className="space-y-1.5">
              <li>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void addTo("new", close)}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-raised disabled:opacity-60"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-accent">
                    {busy === "new" ? <Spinner /> : <Icon name="at" size={18} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">New element</span>
                    <span className="block text-xs text-fg-subtle">Start one with this {media.one}</span>
                  </span>
                </button>
              </li>

              {elements === null ? (
                <li aria-hidden className="ui-skeleton h-14 rounded-xl" />
              ) : (
                elements.map((element) => {
                  const count = element[media.list].length;
                  const full = count >= media.max;
                  return (
                    <li key={element.id}>
                      <button
                        type="button"
                        disabled={busy !== null || full}
                        onClick={() => void addTo(element, close)}
                        className={cx(
                          "flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                          !full && "hover:border-accent hover:bg-raised",
                        )}
                      >
                        <ElementCover element={element} className="h-10 w-10 shrink-0 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">@{element.name}</span>
                          <span className="block truncate text-xs text-fg-subtle">
                            {full
                              ? `Full: ${media.max} ${media.many}`
                              : `${count} of ${media.max} ${media.many}${element.description ? ` · ${element.description}` : ""}`}
                          </span>
                        </span>
                        {busy === element.id && <Spinner />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

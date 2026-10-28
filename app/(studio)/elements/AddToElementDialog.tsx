"use client";

import { useState } from "react";
import { addImageToElement, useElements, type Element } from "@/lib/client/elements";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { saveRunToLibrary } from "@/lib/client/library";
import { MAX_ELEMENT_IMAGES } from "@/lib/element-mentions";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, cx, Spinner } from "@/app/components/ui/primitives";
import ElementDialog from "./ElementDialog";

// --------------------------------------------------
// ADD A GENERATED IMAGE TO AN ELEMENT (window)
//
// From a run's result (Generate page, History): the image
// is copied into the user's library (elements are made of
// library images), then added to an existing element or
// starts a new one in the usual element flow.
// --------------------------------------------------

export default function AddToElementDialog({
  generationId,
  preview,
  onClose,
}: {
  generationId: string;
  // What to show while choosing (the result's link)
  preview: string;
  onClose: () => void;
}) {
  const { elements } = useElements();
  // The element being added to, or "new"
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Element | null>(null);
  // The copied image, once a new element is being made
  const [creating, setCreating] = useState<string | null>(null);

  async function addTo(target: Element | "new", close: () => void) {
    setBusy(target === "new" ? "new" : target.id);
    setError("");
    try {
      const file = await saveRunToLibrary(generationId);
      if (target === "new") {
        setCreating(file.url);
        return;
      }
      setAdded(await addImageToElement(target, file.url));
      setTimeout(close, 1200);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't add the image. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  // A new element: the usual flow, starting with the image
  if (creating) {
    return <ElementDialog element={null} initialImages={[creating]} onClose={onClose} />;
  }

  return (
    <Modal title="Add to element" subtitle="Reuse this image as a reference with @name in later prompts." onClose={onClose}>
      {(close) => (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-line p-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-line bg-black object-cover" />
            <p className="text-xs text-fg-subtle">
              The image is copied into your library, then added as a reference image.
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
                    <span className="block text-xs text-fg-subtle">Start one with this image</span>
                  </span>
                </button>
              </li>

              {elements === null ? (
                <li aria-hidden className="ui-skeleton h-14 rounded-xl" />
              ) : (
                elements.map((element) => {
                  const full = element.images.length >= MAX_ELEMENT_IMAGES;
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={element.images[0]} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-black object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">@{element.name}</span>
                          <span className="block truncate text-xs text-fg-subtle">
                            {full
                              ? `Full: ${MAX_ELEMENT_IMAGES} images`
                              : `${element.images.length} of ${MAX_ELEMENT_IMAGES} images${element.description ? ` · ${element.description}` : ""}`}
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

"use client";

import { useState } from "react";
import { Modal } from "@/app/components/ui/Modal";
import { Button } from "@/app/components/ui/primitives";
import { removeElement } from "@/lib/client/elements";
import { formatDateTime } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/http";
import { elementSummary, type Element } from "@/lib/element-mentions";

// --------------------------------------------------
// ANOTHER USER'S ELEMENT (the super admin, read only)
//
// Its name, who made it, its description and every file
// it carries. Only its owner can change it; the super
// admin can delete it (its files stay in the owner's
// library).
// --------------------------------------------------

export default function ElementViewDialog({
  element,
  canDelete,
  onDeleted,
  onClose,
}: {
  element: Element;
  canDelete: boolean;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const files = element.images.length + element.videos.length + element.audios.length;
  const owner = element.addedBy?.name ?? "its owner";
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove(close: () => void) {
    setDeleting(true);
    setError("");
    try {
      await removeElement(element.id);
      onDeleted();
      close();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the element."));
      setDeleting(false);
    }
  }

  return (
    <Modal
      title={`@${element.name}`}
      subtitle={`Added by ${element.addedBy?.name ?? "another user"} · ${formatDateTime(element.createdAt)} · ${elementSummary(element)}`}
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <>
          <div className="max-h-[65vh] space-y-5 overflow-y-auto p-5">
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Description</h3>
              <p className="text-sm text-fg">{element.description || <span className="text-fg-subtle">None</span>}</p>
            </section>

            {element.images.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  Images ({element.images.length})
                </h3>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {element.images.map((url) => (
                    <li key={url} className="aspect-square overflow-hidden rounded-lg border border-line bg-black">
                      <a href={url} target="_blank" rel="noreferrer" aria-label="Open image">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {element.videos.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  Videos ({element.videos.length})
                </h3>
                <ul className="grid grid-cols-2 gap-2">
                  {element.videos.map((url) => (
                    <li key={url} className="overflow-hidden rounded-lg border border-line bg-black">
                      <video src={url} controls playsInline preload="metadata" className="aspect-video w-full" />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {element.audios.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
                  Voice clips ({element.audios.length})
                </h3>
                <ul className="space-y-2">
                  {element.audios.map((url) => (
                    <li key={url} className="rounded-lg border border-line bg-sunken p-2">
                      <audio src={url} controls preload="none" className="w-full" />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!files && <p className="text-sm text-fg-subtle">This element has no files.</p>}
          </div>

          {error && (
            <p role="alert" className="px-5 pb-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {confirming ? (
              <>
                <span className="text-sm text-fg">
                  Delete @{element.name} for {owner}? Its files stay in their library.
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button onClick={() => setConfirming(false)} disabled={deleting}>
                    Keep
                  </Button>
                  <Button variant="danger" onClick={() => void remove(close)} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-fg-subtle">Only {owner} can edit it.</span>
                <span className="flex shrink-0 gap-2">
                  {canDelete && (
                    <Button variant="ghost" icon="trash" onClick={() => setConfirming(true)}>
                      Delete
                    </Button>
                  )}
                  <Button onClick={close}>Close</Button>
                </span>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

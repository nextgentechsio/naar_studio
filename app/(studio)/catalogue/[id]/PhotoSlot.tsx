"use client";

import { useRef, useState } from "react";
import type { INPUT_SLOTS, PublicProduct } from "@/lib/catalogue/shared";
import { uploadProductImage } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Icon } from "@/app/components/ui/Icon";
import { cx, Spinner } from "@/app/components/ui/primitives";
import { useFileDrop } from "@/app/components/ui/useFileDrop";

// --------------------------------------------------
// ONE GARMENT PHOTO SLOT
//
// Drop a photo on it or click to choose one; it uploads
// straight to Blob (with progress) and is then saved on
// the product. Replace or remove once it has one.
// --------------------------------------------------

type Slot = (typeof INPUT_SLOTS)[number];

export default function PhotoSlot({
  product,
  slot,
  onSave,
}: {
  product: PublicProduct;
  slot: Slot;
  // Saves the slot's URL (null removes it)
  onSave: (url: string | null) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  // null: not uploading; -1: uploading, size unknown
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const url = product.inputs[slot.key] ?? null;
  const busy = progress !== null;

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) return setError("Choose an image (JPG, PNG or WebP)");
    setError("");
    setProgress(-1);
    try {
      const uploaded = await uploadProductImage(product, slot.key, file, (percent) => setProgress(percent ?? -1));
      await onSave(uploaded);
    } catch (err) {
      setError(errorMessage(err, "Upload failed."));
    } finally {
      setProgress(null);
    }
  }

  const { dragging, dropProps } = useFileDrop((files) => void upload(files[0]), { disabled: busy });

  return (
    <div className="space-y-1.5">
      <div
        {...dropProps}
        className={cx(
          "group relative aspect-3/4 overflow-hidden rounded-2xl border transition-all duration-300",
          dragging ? "border-accent ring-2 ring-accent/40" : url ? "border-line" : "border-dashed border-line-strong",
          !url && "bg-sunken",
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${slot.label} photo`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-fg-subtle transition-colors hover:bg-fg/[0.03] hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface transition-transform duration-300 group-hover:-translate-y-0.5">
              <Icon name="upload" size={18} />
            </span>
            <span className="text-xs leading-5">{slot.hint}</span>
          </button>
        )}

        {url && !busy && (
          <span className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="glass flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium text-fg"
            >
              <Icon name="upload" size={12} />
              Replace
            </button>
            <button
              type="button"
              onClick={() => void onSave(null)}
              aria-label={`Remove the ${slot.label.toLowerCase()} photo`}
              className="glass flex items-center justify-center rounded-lg border px-2 py-1.5 text-danger"
            >
              <Icon name="trash" size={13} />
            </button>
          </span>
        )}

        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white backdrop-blur-[2px]">
            <Spinner />
            <span className="text-xs font-medium">{progress >= 0 ? `${Math.round(progress)}%` : "Uploading…"}</span>
            {progress >= 0 && (
              <span className="h-1 w-2/3 overflow-hidden rounded-full bg-white/25">
                <span className="block h-full bg-white transition-[width]" style={{ width: `${progress}%` }} />
              </span>
            )}
          </span>
        )}

        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      <p className="flex items-center gap-1 text-xs font-medium text-fg">
        {slot.label}
        {slot.required && (
          <span className="text-danger" aria-label="required">
            *
          </span>
        )}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

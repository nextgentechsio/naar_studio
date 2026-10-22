"use client";

import { useRef } from "react";
import { useDialog } from "@/app/(studio)/_components/useDialog";
import { Button } from "@/app/components/ui/primitives";
import ModelBrowser from "./ModelBrowser";

// --------------------------------------------------
// BROWSE ALL REPLICATE MODELS (window)
//
// Opened from the Generate page so the search and
// category list don't take room in the Inputs panel.
// Closes once a model is picked.
// --------------------------------------------------

export default function ModelBrowserDialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browse-models-title"
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panel}
        className="relative flex max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id="browse-models-title" className="text-sm font-semibold text-fg">
            All Replicate models
          </h2>
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ModelBrowser variant="dialog" onPicked={onClose} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { Modal } from "@/app/components/ui/Modal";
import ModelBrowser from "./ModelBrowser";

// --------------------------------------------------
// BROWSE ALL REPLICATE MODELS (window)
//
// Opened from the Generate page so the search and
// category list don't take room in the Inputs panel.
// Closes once a model is picked.
// --------------------------------------------------

export default function ModelBrowserDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="All Replicate models" size="xl" onClose={onClose}>
      {(close) => (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-5">
          <ModelBrowser variant="dialog" onPicked={close} />
        </div>
      )}
    </Modal>
  );
}

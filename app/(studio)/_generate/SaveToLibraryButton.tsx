"use client";

import { useState } from "react";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { saveRunToLibrary } from "@/lib/client/library";
import { Button } from "@/app/components/ui/primitives";

// --------------------------------------------------
// "SAVE TO LIBRARY" (Generate page, History)
//
// Copies a run's output into the user's library, to pick
// again as an input in later runs. Saving twice is
// harmless (the server gives back the same file). Give it
// key={generationId} so a new run starts fresh.
// --------------------------------------------------

export default function SaveToLibraryButton({
  generationId,
  size = "md",
}: {
  generationId: string;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("saving");
    setError("");
    try {
      await saveRunToLibrary(generationId);
      setState("saved");
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't save it to the library. Please try again."));
      setState("idle");
    }
  }

  return (
    <Button
      variant="secondary"
      size={size}
      icon={state === "saved" ? "check" : "folder"}
      disabled={state !== "idle"}
      onClick={() => void save()}
      title={error || (state === "saved" ? "In your library: pick it from the upload window" : "Keep a copy to reuse as an input")}
      aria-live="polite"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved to library" : error ? "Retry save" : "Save to library"}
    </Button>
  );
}

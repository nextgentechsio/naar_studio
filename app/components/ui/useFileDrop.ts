"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

// --------------------------------------------------
// DRAG AND DROP FILES ONTO AN ELEMENT
//
// Spread `dropProps` on the drop zone; `dragging` is true
// while files hover it. Also stops the browser from
// opening a file dropped just outside the zone (which
// would navigate away and lose the form).
// --------------------------------------------------

function hasFiles(event: { dataTransfer: DataTransfer | null }) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function useFileDrop(
  onFiles: (files: File[]) => void,
  { disabled = false }: { disabled?: boolean } = {}
) {
  const [dragging, setDragging] = useState(false);
  // dragenter/leave also fire for child elements
  const depth = useRef(0);

  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };

    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);

    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (disabled || !hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      reset();
      if (disabled) return;

      const files = Array.from(event.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };

  return { dragging, dropProps };
}

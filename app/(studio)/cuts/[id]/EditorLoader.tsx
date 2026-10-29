"use client";

import dynamic from "next/dynamic";

// The editor (and its video engine) loads only here, in
// the browser: the rest of the studio never downloads it
const Editor = dynamic(() => import("../_editor/Editor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[var(--canvas)] text-sm text-fg-muted">
      Opening Naar Cuts…
    </div>
  ),
});

export default function EditorLoader({ cutId }: { cutId: string }) {
  return <Editor cutId={cutId} />;
}

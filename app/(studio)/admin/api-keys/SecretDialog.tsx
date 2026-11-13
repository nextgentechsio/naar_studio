"use client";

import { useState } from "react";
import { Modal } from "@/app/components/ui/Modal";
import { Button } from "@/app/components/ui/primitives";
import type { PublicApiKey } from "@/lib/api-keys/shared";

// --------------------------------------------------
// THE SECRET, SHOWN ONCE
// --------------------------------------------------

export default function SecretDialog({
  apiKey: key,
  secret,
  rotated,
  onClose,
}: {
  apiKey: PublicApiKey;
  secret: string;
  rotated: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The field is selectable
    }
  }

  const curl = `curl -X POST ${typeof window === "undefined" ? "" : window.location.origin}/api/v1/generations \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"google/nano-banana","input":{"prompt":"a red bicycle"}}'`;

  return (
    <Modal
      title={rotated ? `New secret for "${key.name}"` : `API key "${key.name}" created`}
      subtitle="Copy it now. For safety it's shown only once; after this only its first characters are kept."
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <div className="flex min-h-0 flex-col">
          <div className="space-y-4 px-5 pb-4 pt-1">
            <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft p-3">
              <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-fg">{secret}</code>
              <Button size="sm" variant="primary" icon={copied ? "check" : "copy"} onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-muted">Try it</p>
              <pre className="overflow-x-auto rounded-xl bg-sunken p-3 font-mono text-[11px] leading-5 text-fg-muted">{curl}</pre>
              <p className="mt-1.5 text-xs text-fg-subtle">
                Then <code className="font-mono">GET /api/v1/generations/&lt;id&gt;</code> until its status is <code className="font-mono">succeeded</code>, and fetch <code className="font-mono">output.url</code>.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="h-4 w-4 accent-accent" />
              I&rsquo;ve saved this key somewhere safe
            </label>
          </div>

          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="primary" disabled={!saved} onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useState } from "react";
import type { ProductShot } from "@/lib/catalogue/shared";
import { downloadImage } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, EmptyState, Spinner } from "@/app/components/ui/primitives";
import { shotState } from "../_parts/product-ui";
import ShotViewer, { shotFileName } from "./ShotViewer";
import type { StepProps } from "./types";

// --------------------------------------------------
// STEP 5: SHOTS (the result)
//
// Every shot of the template once the initial look is
// approved. A shot opens large with its versions; each
// can be regenerated and downloaded, or all at once.
// --------------------------------------------------

export default function ShotsStep({ product, library, act, goTo }: StepProps) {
  const [open, setOpen] = useState<string | null>(null);
  // Download all: how far it got
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const approved = product.status === "shooting" || product.status === "done";
  if (!approved) {
    return (
      <div className="glass rounded-2xl border">
        <EmptyState
          icon="image"
          title="Approve the initial look first"
          description="Once it's approved, every shot in the template is taken from it and shows up here."
          action={
            <Button variant="primary" onClick={() => goTo(4)}>
              Go to the initial look
            </Button>
          }
        />
      </div>
    );
  }

  const states = product.shots.map((shot) => ({ shot, ...shotState(shot) }));
  const ready = states.filter((item) => item.imageUrl);
  const generating = states.filter((item) => item.pending).length;

  async function downloadAll() {
    setError("");
    setSaving({ done: 0, total: ready.length });
    try {
      // One after another: browsers block a burst of downloads
      for (const [index, item] of ready.entries()) {
        await downloadImage(item.imageUrl!, shotFileName(product, item.shot.label));
        setSaving({ done: index + 1, total: ready.length });
      }
    } catch (err) {
      setError(errorMessage(err, "Couldn't download every image."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {ready.length} of {product.shots.length} shots ready
            {generating > 0 && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-xs font-normal text-fg-muted">
                <Spinner className="h-3 w-3" />
                {generating} generating
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Project {product.project.name}
          </p>
        </div>
        <Button
          icon={saving ? undefined : "download"}
          disabled={!ready.length || Boolean(saving)}
          onClick={() => void downloadAll()}
        >
          {saving && <Spinner />}
          {saving ? `Downloading ${saving.done + 1}/${saving.total}` : "Download all"}
        </Button>
      </section>

      {error && <Alert>{error}</Alert>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {states.map((item, index) => (
          <li key={item.shot.shotId} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
            <ShotCard
              shot={item.shot}
              imageUrl={item.imageUrl}
              pending={item.pending}
              failed={item.failed?.error ?? (item.failed ? "Generation failed" : null)}
              initial={index === 0}
              onOpen={() => setOpen(item.shot.shotId)}
            />
          </li>
        ))}
      </ul>

      {open && (
        <ShotViewer product={product} library={library} shotId={open} act={act} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function ShotCard({
  shot,
  imageUrl,
  pending,
  failed,
  initial,
  onOpen,
}: {
  shot: ProductShot;
  imageUrl: string | null;
  pending: boolean;
  failed: string | null;
  initial: boolean;
  onOpen: () => void;
}) {
  const versions = shot.runs.filter((run) => run.status === "succeeded").length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${shot.label}`}
      className="group relative block aspect-3/4 w-full overflow-hidden rounded-2xl border border-line bg-sunken text-left transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className={cx(
            "absolute inset-0 h-full w-full object-cover transition-all duration-500 group-hover:scale-[1.04]",
            pending && "opacity-50 blur-[2px]",
          )}
        />
      ) : pending ? (
        <span className="ui-skeleton absolute inset-0" aria-hidden />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-fg-subtle">
          <Icon name={failed ? "alert" : "image"} size={28} className={failed ? "text-danger" : undefined} />
        </span>
      )}

      {pending && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg">
          <span className="glass flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
            <Spinner className="h-3 w-3" />
            Generating
          </span>
        </span>
      )}

      <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent" />

      {initial && (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          Initial look
        </span>
      )}
      <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100 [@media(hover:none)]:opacity-90">
        <Icon name="eye" size={14} />
      </span>

      <span className="glass absolute inset-x-2 bottom-2 block rounded-xl border px-3 py-2">
        <span className="block truncate text-sm font-semibold text-fg">{shot.label}</span>
        <span className={cx("mt-0.5 block truncate text-[11px]", failed && !pending ? "text-danger" : "text-fg-subtle")}>
          {pending
            ? "Generating…"
            : failed
              ? failed
              : `${versions} version${versions === 1 ? "" : "s"}`}
        </span>
      </span>
    </button>
  );
}

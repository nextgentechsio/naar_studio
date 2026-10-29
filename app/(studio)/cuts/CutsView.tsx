"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, EmptyState, PageHeader } from "@/app/components/ui/primitives";
import { Icon } from "@/app/components/ui/Icon";
import { formatDateTime } from "@/lib/client/format";
import { errorMessage, logRequestError } from "@/lib/client/http";
import { createCut, deleteCut, listCuts } from "@/lib/cuts/client";
import type { CutSummary } from "@/lib/cuts/types";
import "./cuts.css";

// --------------------------------------------------
// NAAR CUTS: YOUR EDITS
// --------------------------------------------------

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function CutsView() {
  const router = useRouter();
  const [cuts, setCuts] = useState<CutSummary[] | null>(null);
  const [storage, setStorage] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await listCuts();
      setCuts(result.cuts);
      setStorage(result.storage);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't load your cuts."));
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads on open
  useEffect(() => void load(), [load]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const cut = await createCut();
      router.push(`/cuts/${cut.id}`);
    } catch (err) {
      logRequestError(err);
      setError(errorMessage(err, "Couldn't create a cut."));
      setCreating(false);
    }
  };

  const remove = async (cut: CutSummary) => {
    if (!window.confirm(`Delete “${cut.name}” and all of its files and exports? This can't be undone.`)) return;
    try {
      await deleteCut(cut.id);
      setCuts((current) => current?.filter((item) => item.id !== cut.id) ?? null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the cut."));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        eyebrow="Create"
        title="Naar Cuts"
        description="Edit your outputs and elements into finished videos: multi-track timeline, transitions, titles, colour and sound, exported right in your browser."
        actions={
          <Button variant="primary" icon="film" onClick={() => void create()} disabled={creating || !storage}>
            {creating ? "Creating…" : "New cut"}
          </Button>
        }
      />

      {!storage && <Alert tone="warning">File storage isn&apos;t set up on the server, so cuts can&apos;t hold media yet.</Alert>}
      {error && <Alert>{error}</Alert>}

      {cuts === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="aspect-video animate-pulse rounded-2xl bg-raised" />
          ))}
        </div>
      ) : cuts.length === 0 ? (
        <EmptyState
          icon="film"
          title="No cuts yet"
          description="Start a cut, then drag your videos, images, voices and elements onto the timeline."
          action={
            <Button variant="primary" icon="film" onClick={() => void create()} disabled={creating || !storage}>
              New cut
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cuts.map((cut) => (
            <div
              key={cut.id}
              className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-transform duration-300 hover:-translate-y-1"
            >
              <Link href={`/cuts/${cut.id}`} className="block">
                <div className="relative aspect-video overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgb(47_214_200/0.35),transparent_55%),radial-gradient(circle_at_90%_90%,rgb(124_92_255/0.35),transparent_55%),var(--sunken)]">
                  {cut.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cut.posterUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  )}
                  {!cut.posterUrl && (
                    <div className="grid h-full place-items-center text-white/70">
                      <Icon name="film" size={32} />
                    </div>
                  )}
                  {cut.durationMs > 0 && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                      {duration(cut.durationMs)}
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="truncate text-sm font-semibold text-fg">{cut.name}</h3>
                  <p className="mt-0.5 text-xs text-fg-subtle">Edited {formatDateTime(cut.updatedAt)}</p>
                </div>
              </Link>
              <button
                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/50 text-white opacity-0 backdrop-blur transition-opacity hover:bg-[var(--danger)] group-hover:opacity-100"
                onClick={() => void remove(cut)}
                aria-label={`Delete ${cut.name}`}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, EmptyState, inputClass, PageHeader, Spinner } from "@/app/components/ui/primitives";
import { createBoard, deleteBoard, duplicateBoard, fetchBoards, renameBoard, type PublicBoard } from "@/lib/client/boards";
import { formatDateTime } from "@/lib/client/format";
import { errorMessage } from "@/lib/client/http";

// --------------------------------------------------
// BOARDS: the user's boards, newest first
//
// The super admin can switch to everyone's boards, each
// marked with whose it is; those open view only.
// --------------------------------------------------

export default function BoardsView() {
  const router = useRouter();
  const { currentUser } = useStudio();
  const seesAll = currentUser.role === "super_admin" && !currentUser.disabled;
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [boards, setBoards] = useState<PublicBoard[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchBoards(scope)
      .then((list) => !cancelled && setBoards(list))
      .catch((err) => {
        if (cancelled) return;
        setBoards([]);
        setError(errorMessage(err, "Couldn't load the boards."));
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const board = await createBoard();
      router.push(`/boards/${board.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create a board."));
      setCreating(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const shown = (boards ?? []).filter(
    (board) => board.name.toLowerCase().includes(needle) || (scope === "all" && board.ownerName.toLowerCase().includes(needle))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Boards"
        description="Moodboards, shot plans and brainstorms. Put outputs, elements and notes side by side on an endless canvas."
        actions={
          <Button variant="primary" icon={creating ? undefined : "plus"} onClick={() => void create()} disabled={creating}>
            {creating && <Spinner />}
            New board
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}

      {seesAll && (
        <div role="group" aria-label="Whose boards" className="flex gap-1.5">
          {(
            [
              ["mine", "My boards"],
              ["all", "Everyone's"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => {
                if (scope === value) return;
                setBoards(null);
                setScope(value);
              }}
              className={cx(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                scope === value ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {boards && boards.length > 0 && (
        <div className="relative w-full max-w-sm">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${boards.length} board${boards.length === 1 ? "" : "s"}${scope === "all" ? " or whose" : ""}`}
            aria-label="Search boards"
            className={cx(inputClass, "pl-9")}
          />
        </div>
      )}

      {boards === null ? (
        <ul aria-label="Loading boards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="overflow-hidden rounded-2xl border border-line">
              <div className="ui-skeleton aspect-[16/10]" />
              <div className="space-y-2 p-3">
                <div className="ui-skeleton h-3.5 w-1/2 rounded" />
                <div className="ui-skeleton h-3 w-1/3 rounded" />
              </div>
            </li>
          ))}
        </ul>
      ) : boards.length === 0 && scope === "all" ? (
        <p className="py-12 text-center text-sm text-fg-muted">No one has made a board yet.</p>
      ) : boards.length === 0 ? (
        <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
          <EmptyState
            icon="board"
            title="No boards yet"
            description="A board is an endless canvas for moodboards, shot plans and brainstorms. Bring in outputs and elements, add sticky notes, group them in frames."
            action={
              <Button variant="primary" icon="plus" onClick={() => void create()} disabled={creating}>
                Create your first board
              </Button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">Nothing matches &ldquo;{query}&rdquo;</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((board, index) => (
            <li key={board.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
              <BoardCard
                board={board}
                owner={board.ownerId === currentUser.id ? null : board.ownerName}
                onChanged={(next) => setBoards((now) => now?.map((item) => (item.id === next.id ? next : item)) ?? null)}
                onAdded={(next) => setBoards((now) => [next, ...(now ?? [])])}
                onRemoved={() => setBoards((now) => now?.filter((item) => item.id !== board.id) ?? null)}
                onError={setError}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardCard({
  board,
  owner,
  onChanged,
  onAdded,
  onRemoved,
  onError,
}: {
  board: PublicBoard;
  // Whose it is, when it isn't the viewer's (view only)
  owner: string | null;
  onChanged: (board: PublicBoard) => void;
  onAdded: (board: PublicBoard) => void;
  onRemoved: () => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(board.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act<T>(work: () => Promise<T>, fallback: string): Promise<T | null> {
    setBusy(true);
    try {
      return await work();
    } catch (err) {
      onError(errorMessage(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl">
      <Link href={`/boards/${board.id}`} className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" aria-label={`Open ${board.name}`}>
        <div
          className="relative aspect-[16/10] overflow-hidden bg-[var(--board-bg)]"
          style={{ backgroundImage: "radial-gradient(var(--board-dot) 1px, transparent 0)", backgroundSize: "16px 16px" }}
        >
          {board.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={board.coverUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-fg-subtle">
              <Icon name="board" size={32} />
            </span>
          )}
        </div>
      </Link>

      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onBlur={async () => {
                setRenaming(false);
                const clean = name.trim();
                if (!clean || clean === board.name) return setName(board.name);
                const next = await act(() => renameBoard(board.id, clean), "Couldn't rename the board.");
                if (next) onChanged(next);
                else setName(board.name);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(board.name);
                  setRenaming(false);
                }
              }}
              aria-label="Board name"
              className={cx(inputClass, "h-8 py-0 text-sm font-semibold")}
            />
          ) : (
            <p className="truncate text-sm font-semibold text-fg">{board.name}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-fg-subtle">
            {board.itemCount} item{board.itemCount === 1 ? "" : "s"} · edited {formatDateTime(board.updatedAt)}
          </p>
          {owner && (
            <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-fg-subtle" title={`${owner}'s board — view only`}>
              <Icon name="users" size={10} className="shrink-0" />
              <span className="font-medium text-fg-muted">{owner}</span> · view only
            </p>
          )}
        </div>

        {owner ? null : confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const ok = await act(() => deleteBoard(board.id), "Couldn't delete the board.");
                if (ok !== null) onRemoved();
                setConfirming(false);
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <MiniButton icon="edit" label="Rename" onClick={() => setRenaming(true)} />
            <MiniButton
              icon="copy"
              label="Duplicate"
              onClick={async () => {
                const copy = await act(() => duplicateBoard(board.id), "Couldn't duplicate the board.");
                if (copy) onAdded(copy);
              }}
            />
            <MiniButton icon="trash" label="Delete" onClick={() => setConfirming(true)} />
          </div>
        )}
      </div>
    </div>
  );
}

function MiniButton({ icon, label, onClick }: { icon: "edit" | "copy" | "trash"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-subtle hover:bg-raised hover:text-fg"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

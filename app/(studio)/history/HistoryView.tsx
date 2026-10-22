"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import { Icon } from "@/app/components/ui/Icon";
import {
  Alert,
  Button,
  buttonClass,
  cx,
  EmptyState,
  PageHeader,
} from "@/app/components/ui/primitives";
import {
  fetchHistoryPage,
  type HistoryPage,
  type HistoryStatus,
} from "@/lib/client/data";
import { errorMessage } from "@/lib/client/http";
import { canManageUsers } from "@/lib/roles";
import GenerationCard, { GenerationCardSkeleton } from "./GenerationCard";
import GenerationDrawer from "./GenerationDrawer";
import HistoryFilters, { type FilterValues } from "./HistoryFilters";
import { isRunningStatus } from "./OutputPreview";

// --------------------------------------------------
// HISTORY
//
// A paged, filterable grid. Filters, page and the open
// generation (?view=<id>) live in the URL, so any view
// can be refreshed, shared or left with Back.
// --------------------------------------------------

const PAGE_SIZE = 24;
const RUNNING_REFRESH_MS = 5000;
const STATUSES: HistoryStatus[] = ["succeeded", "failed", "running"];

// 4 columns on a laptop, 5 on wide screens: enough to
// scan, big enough to judge an image
const GRID_CLASS =
  "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

const FILTER_KEYS = ["q", "project", "model", "user", "status"] as const;

function readFilters(params: URLSearchParams): FilterValues {
  const status = params.get("status") as HistoryStatus | null;

  return {
    q: params.get("q") ?? "",
    project: params.get("project") ?? "",
    model: params.get("model") ?? "",
    user: params.get("user") ?? "",
    status: status && STATUSES.includes(status) ? status : "",
  };
}

export default function HistoryView() {
  const { currentUser } = useStudio();
  const isManager = canManageUsers(currentUser);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = readFilters(searchParams);
  // Whole, positive, finite page numbers only
  const rawPage = Math.floor(Number(searchParams.get("page")));
  const page = Number.isFinite(rawPage) && rawPage > 1 ? rawPage : 1;
  const viewId = searchParams.get("view");

  // What the API is asked for (the open drawer doesn't
  // change the list)
  const listParams = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    if (filters[key]) listParams.set(key, filters[key]);
  }
  listParams.set("page", String(page));
  const listKey = listParams.toString();

  // ---------- URL updates ----------

  const updateUrl = useCallback(
    (patch: Record<string, string | null>, mode: "push" | "replace") => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }

      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;

      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Filter changes go back to page 1 and replace the
  // history entry (typing shouldn't fill the Back stack)
  const changeFilters = useCallback(
    (patch: Partial<FilterValues>) =>
      updateUrl({ ...patch, page: null }, "replace"),
    [updateUrl],
  );

  const clearFilters = () =>
    updateUrl(
      {
        q: null,
        project: null,
        model: null,
        user: null,
        status: null,
        page: null,
      },
      "replace",
    );

  const goToPage = (next: number) => {
    updateUrl({ page: next > 1 ? String(next) : null }, "push");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Opening pushes a history entry, so closing goes Back
  // (one Back press from the grid, not two). A drawer that
  // came from a shared link has nothing to go back to.
  const openedHereRef = useRef(false);

  const openGeneration = (id: string) => {
    openedHereRef.current = true;
    updateUrl({ view: id }, "push");
  };

  const closeGeneration = useCallback(() => {
    if (openedHereRef.current) {
      openedHereRef.current = false;
      router.back();
    } else {
      updateUrl({ view: null }, "replace");
    }
  }, [router, updateUrl]);

  // ---------- Data ----------

  const [result, setResult] = useState<{
    key: string;
    data?: HistoryPage;
    error?: string;
  }>({ key: "" });

  // Bumped to re-fetch while generations are running
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(listKey);

    fetchHistoryPage({
      page: Number(params.get("page")) || 1,
      pageSize: PAGE_SIZE,
      q: params.get("q") ?? undefined,
      project: params.get("project") ?? undefined,
      model: params.get("model") ?? undefined,
      user: params.get("user") ?? undefined,
      status: (params.get("status") as HistoryStatus) ?? undefined,
    })
      .then((data) => {
        if (!cancelled) setResult({ key: listKey, data });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult((previous) => ({
            key: listKey,
            // Keep showing the last good page
            data: previous.data,
            error: errorMessage(err, "Unable to load history."),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listKey, refreshTick]);

  const data = result.data;
  const loading = result.key !== listKey;
  const generations = data?.generations ?? [];

  // Keep running generations fresh without a manual reload
  const hasRunning = generations.some((item) => isRunningStatus(item.status));

  useEffect(() => {
    if (!hasRunning) return;

    const timer = setTimeout(
      () => setRefreshTick((tick) => tick + 1),
      RUNNING_REFRESH_MS,
    );
    return () => clearTimeout(timer);
  }, [hasRunning, result]);

  // ---------- Derived ----------

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = FILTER_KEYS.some((key) => filters[key]);

  const description = isManager
    ? "Every generation across the workspace."
    : "Your generations.";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Library" title="History" description={description} />

      <HistoryFilters
        values={filters}
        options={data?.options}
        showUser={isManager}
        onChange={changeFilters}
        onClear={clearFilters}
      />

      {result.error && result.key === listKey && <Alert>{result.error}</Alert>}

      {/* Count + pagination summary */}
      {data && generations.length > 0 && (
        <p className="text-sm text-fg-muted" aria-live="polite">
          Showing{" "}
          <span className="font-medium text-fg">
            {first}–{last}
          </span>{" "}
          of <span className="font-medium text-fg">{total}</span>
          {filtered ? " matching" : ""} generation{total === 1 ? "" : "s"}
        </p>
      )}

      {!data ? (
        loading ? (
          <div className={GRID_CLASS}>
            {Array.from({ length: 8 }, (_, index) => (
              <GenerationCardSkeleton key={index} />
            ))}
          </div>
        ) : null
      ) : !generations.length ? (
        <div className="rounded-xl border border-line bg-surface">
          {page > 1 && total > 0 ? (
            <EmptyState
              icon="history"
              title="This page is empty"
              action={
                <Button size="sm" onClick={() => goToPage(1)}>
                  Back to page 1
                </Button>
              }
            />
          ) : filtered ? (
            <EmptyState
              icon="search"
              title="No generations match these filters"
              description="Try a different search, or clear the filters."
              action={
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="image"
              title="Nothing generated yet"
              description="Every run you start is saved here, with its cost."
              action={
                <Link href="/replicate" className={buttonClass("primary", "sm")}>
                  Start generating
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <div
          className={cx(
            GRID_CLASS,
            "transition-opacity",
            loading && "opacity-60",
          )}
          aria-busy={loading}
        >
          {generations.map((generation) => (
            <GenerationCard
              key={generation.id}
              generation={generation}
              showUser={isManager}
              onOpen={() => openGeneration(generation.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && pageCount > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3 border-t border-line pt-4"
        >
          <Button
            size="sm"
            icon="chevronLeft"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </Button>

          <span className="text-sm text-fg-muted">
            Page {Math.min(page, pageCount)} of {pageCount}
          </span>

          <Button
            size="sm"
            disabled={page >= pageCount}
            onClick={() => goToPage(page + 1)}
          >
            Next
            <Icon name="chevronRight" size={16} />
          </Button>
        </nav>
      )}

      {viewId && (
        <GenerationDrawer
          id={viewId}
          preview={generations.find((item) => item.id === viewId)}
          showUser={isManager}
          onClose={closeGeneration}
        />
      )}
    </div>
  );
}

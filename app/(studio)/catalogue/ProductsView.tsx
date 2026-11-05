"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useStudio } from "@/app/(studio)/_components/StudioProvider";
import type { ProductSummary } from "@/lib/catalogue/shared";
import { catalogueApi } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Icon } from "@/app/components/ui/Icon";
import { Alert, Button, cx, EmptyState, formatCost, inputClass, PageHeader } from "@/app/components/ui/primitives";
import NewProductDialog from "./_parts/NewProductDialog";
import { StatusBadge, timeAgo } from "./_parts/product-ui";

// --------------------------------------------------
// CATALOGUE: PRODUCTS
//
// Every product the user is shooting (admins see
// everyone's, marked with who made it), by project: every
// image is billed to its product's project, so the bar
// shows what each project has spent on catalogue shoots.
// A card opens the product's workspace.
// --------------------------------------------------

export default function ProductsView() {
  const { currentUser } = useStudio();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    catalogueApi
      .products()
      .then((data) => !cancelled && setProducts(data.products))
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Couldn't load your products."));
        setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ?project=<id>; none = all projects
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";
  const { projects } = useStudio();
  const choose = (id: string) => router.replace(id ? `${pathname}?project=${id}` : pathname, { scroll: false });

  // Active projects, plus any (archived) a product is in
  const scopes = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; spendUsd: number; products: number; images: number }>();
    for (const project of projects) byId.set(project.id, { id: project.id, name: project.name, spendUsd: 0, products: 0, images: 0 });
    for (const item of products ?? []) {
      const entry = byId.get(item.project.id) ?? { id: item.project.id, name: item.project.name, spendUsd: 0, products: 0, images: 0 };
      entry.spendUsd += item.spendUsd;
      entry.products++;
      entry.images += item.images;
      byId.set(item.project.id, entry);
    }
    return [...byId.values()].sort((a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name));
  }, [projects, products]);
  const scope = scopes.find((item) => item.id === projectId) ?? null;

  const needle = query.trim().toLowerCase();
  const shown = (products ?? []).filter((item) => (!scope || item.project.id === scope.id)).filter((item) =>
    [item.name, item.sku, item.category, item.project.name, item.owner.name].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );

  const newButton = (
    <Button variant="primary" icon="shirt" onClick={() => setCreating(true)}>
      New product
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalogue"
        description="Shoot your garments on AI models, every catalogue angle, billed to a project."
        actions={newButton}
      />

      {error && <Alert>{error}</Alert>}

      {products && (
        <ProjectBar
          scopes={scopes}
          scope={scope}
          total={{
            spendUsd: products.reduce((sum, item) => sum + item.spendUsd, 0),
            products: products.length,
            images: products.reduce((sum, item) => sum + item.images, 0),
          }}
          onChoose={choose}
        />
      )}

      {products && products.length > 0 && (
        <div className="relative w-full max-w-sm">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${scope ? scope.products : products.length} product${(scope ? scope.products : products.length) === 1 ? "" : "s"}`}
            aria-label="Search products"
            className={cx(inputClass, "pl-9")}
          />
        </div>
      )}

      {products === null ? (
        <ul aria-label="Loading products" className={GRID}>
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="ui-skeleton aspect-3/4 rounded-2xl" />
          ))}
        </ul>
      ) : products.length === 0 ? (
        !error && (
          <div className="ui-rise rounded-2xl border border-dashed border-line-strong">
            <EmptyState
              icon="shirt"
              title="No products yet"
              description="Add a garment's photos, pick a template and a model, approve an initial look, and every catalogue angle is shot for you."
              action={newButton}
            />
          </div>
        )
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">
          {needle ? <>Nothing matches &ldquo;{query}&rdquo;</> : <>No products in {scope?.name ?? "this project"} yet</>}
        </p>
      ) : (
        <ul className={GRID}>
          {shown.map((product, index) => (
            <li key={product.id} className="ui-rise" style={{ "--i": index } as React.CSSProperties}>
              <ProductCard product={product} owner={product.owner.id === currentUser.id ? null : product.owner.name} />
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewProductDialog
          onClose={() => setCreating(false)}
          defaultProject={scope && projects.some((item) => item.id === scope.id) ? scope.name : ""}
        />
      )}
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";

function ProductCard({ product, owner }: { product: ProductSummary; owner: string | null }) {
  return (
    <Link
      href={`/catalogue/${product.id}`}
      className="group relative block aspect-3/4 overflow-hidden rounded-2xl border border-line bg-sunken transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {product.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.cover}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-accent-soft text-accent">
          <Icon name="shirt" size={40} className="opacity-70 transition-transform duration-500 group-hover:scale-110" />
        </span>
      )}

      <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-transparent" />

      <span className="absolute left-2.5 top-2.5">
        <StatusBadge status={product.status} className="bg-surface/80 backdrop-blur" />
      </span>

      <span className="glass absolute inset-x-2 bottom-2 block rounded-xl border px-3 py-2.5">
        <span className="block truncate text-sm font-semibold text-fg">{product.name}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">
          {[product.sku, product.project.name].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-fg-subtle">
          {owner && (
            <>
              <Icon name="users" size={10} className="shrink-0" />
              <span className="truncate font-medium text-fg-muted">{owner}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">Updated {timeAgo(product.updatedAt)}</span>
          {product.spendUsd > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 font-medium tabular-nums text-fg-muted">{formatCost(product.spendUsd)}</span>
            </>
          )}
        </span>
      </span>
    </Link>
  );
}

type Scope = { id: string; name: string; spendUsd: number; products: number; images: number };

// The project being viewed, and what catalogue shoots
// have cost there (the same expenses as Expenses shows)
function ProjectBar({
  scopes,
  scope,
  total,
  onChoose,
}: {
  scopes: Scope[];
  scope: Scope | null;
  total: Omit<Scope, "id" | "name">;
  onChoose: (id: string) => void;
}) {
  const shown = scope ?? { ...total, name: "All projects" };
  return (
    <section aria-label="Project" className="glass ui-rise space-y-4 rounded-2xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-subtle">Catalogue spend</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[28px] font-bold tabular-nums tracking-[-0.02em] text-fg">{formatCost(shown.spendUsd)}</span>
            <span className="truncate text-sm text-fg-muted">{shown.name}</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {shown.products} product{shown.products === 1 ? "" : "s"} · {shown.images} image{shown.images === 1 ? "" : "s"}
            {scope && (
              <>
                {" · "}
                <Link
                  href={`/expenses?project=${encodeURIComponent(scope.id)}`}
                  className="font-medium text-accent hover:underline"
                >
                  See in Expenses
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Projects" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        <ProjectChip active={!scope} label="All projects" spendUsd={total.spendUsd} onClick={() => onChoose("")} />
        {scopes.map((item) => (
          <ProjectChip
            key={item.id}
            active={scope?.id === item.id}
            label={item.name}
            spendUsd={item.spendUsd}
            onClick={() => onChoose(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectChip({ active, label, spendUsd, onClick }: { active: boolean; label: string; spendUsd: number; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "border-accent bg-accent text-on-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
      )}
    >
      <Icon name="folder" size={13} className="shrink-0 opacity-80" />
      <span className="max-w-[12rem] truncate">{label}</span>
      {spendUsd > 0 && (
        <span className={cx("tabular-nums text-xs", active ? "opacity-80" : "text-fg-subtle")}>{formatCost(spendUsd)}</span>
      )}
    </button>
  );
}

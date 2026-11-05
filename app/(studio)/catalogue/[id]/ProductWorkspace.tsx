"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicProduct } from "@/lib/catalogue/shared";
import { catalogueApi, type Library } from "@/lib/client/catalogue";
import { errorMessage } from "@/lib/client/http";
import { Icon } from "@/app/components/ui/Icon";
import { Modal } from "@/app/components/ui/Modal";
import { Alert, Badge, Button, EmptyState, Spinner } from "@/app/components/ui/primitives";
import { hasPending, StatusBadge } from "../_parts/product-ui";
import DetailsStep from "./DetailsStep";
import InitialLookStep from "./InitialLookStep";
import ShotsStep from "./ShotsStep";
import Stepper, { defaultStep, type Step } from "./Stepper";
import StylingStep from "./StylingStep";
import TemplateStep from "./TemplateStep";
import type { StepProps } from "./types";

// --------------------------------------------------
// A CATALOGUE PRODUCT'S WORKSPACE
//
// Details → Template → Model → Initial look → Shots.
// Opens on the step its status calls for; any step can
// be opened from the stepper. While any run is still
// generating, the product is read again every 3 s (the
// server brings its runs up to date on each read).
// --------------------------------------------------

const POLL_MS = 3000;

export default function ProductWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const [loadError, setLoadError] = useState("");
  const [library, setLibrary] = useState<Library | null>(null);
  const [step, setStep] = useState<Step>(1);
  // Which way the last step change went (for the motion)
  const [forward, setForward] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pollError, setPollError] = useState(0);

  useEffect(() => {
    let cancelled = false;
    catalogueApi
      .product(id)
      .then(({ product }) => {
        if (cancelled) return;
        setProduct(product);
        setStep(defaultStep(product));
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, "Couldn't load this product.")));
    catalogueApi
      .library()
      .then((data) => !cancelled && setLibrary(data))
      .catch((err) => !cancelled && setError(errorMessage(err, "Couldn't load the library.")));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Reads again while something is generating; each new
  // product (or a failed read) schedules the next one
  const pending = product ? hasPending(product.shots) : false;
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      catalogueApi
        .product(id)
        .then(({ product }) => !cancelled && setProduct(product))
        .catch(() => !cancelled && setPollError((count) => count + 1));
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, pending, product, pollError]);

  // Ignore results of a request that a newer one overtook
  const latest = useRef(0);
  const run = useCallback(async (request: () => Promise<{ product: PublicProduct }>, fallback: string) => {
    const ticket = ++latest.current;
    setSaving(true);
    setError("");
    try {
      const { product } = await request();
      if (ticket === latest.current) setProduct(product);
      return null;
    } catch (err) {
      const message = errorMessage(err, fallback);
      setError(message);
      return message;
    } finally {
      if (ticket === latest.current) setSaving(false);
    }
  }, []);

  const update = useCallback(
    async (body: Record<string, unknown>) =>
      (await run(() => catalogueApi.updateProduct(id, body), "Couldn't save the change.")) === null,
    [id, run],
  );

  const goTo = useCallback(
    (next: Step) => {
      setForward(next >= step);
      setStep(next);
      setError("");
    },
    [step],
  );

  if (loadError) {
    return (
      <div className="glass rounded-2xl border">
        <EmptyState
          icon="alert"
          title="Couldn't open this product"
          description={loadError}
          action={
            <Link href="/catalogue" className="text-sm font-medium text-accent hover:underline">
              Back to products
            </Link>
          }
        />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="space-y-4" aria-label="Loading product">
        <div className="ui-skeleton h-9 w-64 rounded-lg" />
        <div className="ui-skeleton h-14 rounded-2xl" />
        <div className="ui-skeleton h-96 rounded-2xl" />
      </div>
    );
  }

  const props: StepProps = { product, library, update, act: run, goTo };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/catalogue"
            className="inline-flex items-center gap-1 text-xs font-medium text-fg-subtle transition-colors hover:text-fg"
          >
            <Icon name="chevronLeft" size={14} />
            All products
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-[-0.02em] text-fg sm:text-[28px]">{product.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <StatusBadge status={product.status} />
            {product.sku && <Badge>{product.sku}</Badge>}
            <span className="inline-flex items-center gap-1">
              <Icon name="folder" size={12} />
              {product.project.name}
            </span>
            {saving && (
              <span className="inline-flex items-center gap-1.5 text-fg-subtle" role="status">
                <Spinner className="h-3 w-3" />
                Saving…
              </span>
            )}
          </div>
        </div>
        <ProductMenu
          product={product}
          onDeleted={() => {
            router.push("/catalogue");
            router.refresh();
          }}
        />
      </header>

      <Stepper product={product} step={step} onStep={goTo} />

      {error && <Alert>{error}</Alert>}

      <div key={step} className={forward ? "ui-step-forward" : "ui-step-back"}>
        {step === 1 && <DetailsStep {...props} />}
        {step === 2 && <TemplateStep {...props} />}
        {step === 3 && <StylingStep {...props} />}
        {step === 4 && <InitialLookStep {...props} />}
        {step === 5 && <ShotsStep {...props} />}
      </div>
    </div>
  );
}

// "More" menu: delete the product
function ProductMenu({ product, onDeleted }: { product: PublicProduct; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={menu} className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon="menu"
        aria-label="Product options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div role="menu" className="ui-menu glass-menu absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border p-1 [transform-origin:top_right]">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
          >
            <Icon name="trash" size={15} />
            Delete product
          </button>
        </div>
      )}
      {confirming && <DeleteDialog product={product} onDeleted={onDeleted} onClose={() => setConfirming(false)} />}
    </div>
  );
}

function DeleteDialog({
  product,
  onDeleted,
  onClose,
}: {
  product: PublicProduct;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      await catalogueApi.deleteProduct(product.id);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the product."));
      setDeleting(false);
    }
  }

  return (
    <Modal title={`Delete ${product.name}?`} size="sm" onClose={onClose}>
      {(close) => (
        <>
          <div className="space-y-3 px-5 pb-4 pt-1 text-sm text-fg-muted">
            <p>
              Its photos and shots are removed from the catalogue. The images stay in History, and what they cost stays in
              Expenses under {product.project.name}.
            </p>
            {error && <Alert>{error}</Alert>}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button onClick={close} disabled={deleting}>
              Keep
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void remove()} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

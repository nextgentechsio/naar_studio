"use client";

import Link from "next/link";
import { Icon } from "@/app/components/ui/Icon";
import { buttonClass, Card, cx, PageHeader } from "@/app/components/ui/primitives";

// --------------------------------------------------
// HIGGSFIELD (placeholder)
//
// A second generation provider beside Replicate. Only
// the page exists so far; the integration comes later.
// --------------------------------------------------

export default function HiggsfieldView() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Create"
        title="Higgsfield"
        description="Cinematic image and video generation with Higgsfield."
      />

      <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft text-accent">
          <Icon name="video" size={22} />
        </span>

        <span className="mt-5 rounded-full border border-line bg-sunken px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
          Coming soon
        </span>

        <p className="mt-3 text-base font-semibold text-fg">
          Higgsfield is on its way
        </p>

        <p className="mt-1 max-w-md text-sm text-fg-muted">
          You&apos;ll be able to run Higgsfield models here, charged to your
          projects and saved to History like every Replicate run.
        </p>

        <Link href="/replicate" className={cx(buttonClass("secondary", "sm"), "mt-6")}>
          Use Replicate for now
        </Link>
      </Card>
    </div>
  );
}

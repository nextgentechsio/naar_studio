"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/app/components/ui/primitives";

// Catalogue's own sections (one nav item in the shell)
const TABS = [
  { href: "/catalogue", label: "Products" },
  { href: "/catalogue/library", label: "Library" },
];

export default function CatalogueTabs() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/catalogue" ? pathname === "/catalogue" || /^\/catalogue\/[0-9a-f]{24}/.test(pathname) : pathname.startsWith(href);

  return (
    <nav aria-label="Catalogue" className="glass inline-flex gap-1 rounded-full p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={active(tab.href) ? "page" : undefined}
          className={cx(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            active(tab.href) ? "bg-accent text-on-accent" : "text-fg-muted hover:bg-fg/[0.06] hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

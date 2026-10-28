"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";
import { Icon, type IconName } from "@/app/components/ui/Icon";
import { NaarLogo } from "@/app/components/ui/NaarLogo";
import {
  Button,
  buttonClass,
  cx,
} from "@/app/components/ui/primitives";
import {
  canManageProjects,
  canManageUsers,
  ROLE_LABELS,
} from "@/lib/auth/roles";
import AppFooter from "@/app/components/AppFooter";
import { APP_NAME } from "@/lib/app-info";
import { signOut, useStudio } from "./StudioProvider";
import Greeting from "./Greeting";
import SessionTimer from "./SessionTimer";
import SidebarToggle from "./SidebarToggle";
import { useDialog } from "./useDialog";

// --------------------------------------------------
// STUDIO SHELL
//
// Sidebar (desktop rail, collapsible to icons; mobile
// drawer), top bar and main area. Navigation is real links, so every page
// has a URL: refresh, Back and shared links all work.
// Grouped by job: Create → Library → Spend → Admin.
// --------------------------------------------------

type NavItem = { href: string; label: string; icon: IconName };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function StudioShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { currentUser, sessionStartedAt } = useStudio();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "Create",
      items: [
        { href: "/replicate", label: "Replicate", icon: "sparkles" },
        { href: "/higgsfield", label: "Higgsfield", icon: "video" },
        { href: "/elevenlabs", label: "ElevenLabs", icon: "audio" },
      ],
    },
    {
      label: "Library",
      items: [
        { href: "/history", label: "History", icon: "history" },
        { href: "/elements", label: "Elements", icon: "at" },
      ],
    },
    {
      label: "Spend",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "chart" },
        { href: "/expenses", label: "Expenses", icon: "wallet" },
      ],
    },
    ...(canManageUsers(currentUser)
      ? [
          {
            label: "Admin",
            items: [
              { href: "/admin/users", label: "Users", icon: "users" as const },
              ...(canManageProjects(currentUser)
                ? [
                    {
                      href: "/admin/projects",
                      label: "Projects",
                      icon: "folder" as const,
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
  ];

  const allItems = [
    ...navGroups.flatMap((group) => group.items),
    { href: "/account", label: "Account", icon: "settings" as const },
  ];

  const pageTitle =
    allItems.find((item) => isActive(pathname, item.href))?.label ?? "";

  const closeNav = () => setNavOpen(false);

  // Sidebar body, shared by the desktop rail and the
  // mobile drawer
  function renderNav() {
    return (
      <div className="flex h-full flex-col">
        {/* Brand lockup: naar wordmark + "Studio" */}
        <Link
          href="/replicate"
          onClick={closeNav}
          aria-label={`${APP_NAME} home`}
          className="flex h-16 items-center gap-2 px-5 text-fg rail-collapsed:justify-center rail-collapsed:px-0"
        >
          <span className="contents rail-collapsed:hidden">
            <NaarLogo height={24} />
            <span className="pt-0.5 text-[15px] font-medium tracking-tight text-fg-muted">
              Studio
            </span>
          </span>
          {/* Collapsed rail: just the wordmark, smaller */}
          <span className="hidden rail-collapsed:inline-flex">
            <NaarLogo height={14} />
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="flex-1 space-y-6 overflow-y-auto px-3 py-3 rail-collapsed:space-y-3 rail-collapsed:px-2"
        >
          {navGroups.map((group) => (
            <div
              key={group.label}
              className="rail-collapsed:border-t rail-collapsed:border-line rail-collapsed:pt-3 rail-collapsed:first:border-t-0 rail-collapsed:first:pt-0"
            >
              <p className="px-2.5 pb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-fg-subtle rail-collapsed:sr-only">
                {group.label}
              </p>

              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={closeNav}
                        aria-current={active ? "page" : undefined}
                        title={item.label}
                        className={cx(
                          "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors rail-collapsed:justify-center rail-collapsed:px-0",
                          active
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-fg-muted hover:bg-raised hover:text-fg"
                        )}
                      >
                        {/* NAAR cyan marker on the active page */}
                        {active && (
                          <span
                            aria-hidden
                            className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand"
                          />
                        )}
                        <Icon name={item.icon} size={17} />
                        <span className="rail-collapsed:sr-only">
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Signed-in user */}
        <div className="border-t border-line p-3">
          <div
            className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 rail-collapsed:justify-center rail-collapsed:px-0"
            title={`${currentUser.name} · ${ROLE_LABELS[currentUser.role]}`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-fg"
              aria-hidden
            >
              {currentUser.name.charAt(0).toUpperCase() || "?"}
            </span>

            <span className="min-w-0 flex-1 rail-collapsed:hidden">
              <span className="block truncate text-sm font-medium text-fg">
                {currentUser.name}
              </span>
              <span className="block truncate text-xs text-fg-subtle">
                {ROLE_LABELS[currentUser.role]}
              </span>
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 px-1.5 rail-collapsed:hidden">
            <span className="text-xs text-fg-subtle">Theme</span>
            <ThemeToggle />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1 rail-collapsed:grid-cols-1">
            <Link
              href="/account"
              onClick={closeNav}
              aria-current={
                isActive(pathname, "/account") ? "page" : undefined
              }
              title="Account"
              className={buttonClass("ghost", "sm")}
            >
              <Icon name="settings" size={16} />
              <span className="rail-collapsed:sr-only">Account</span>
            </Link>

            <Button
              size="sm"
              variant="ghost"
              icon="logout"
              title="Sign out"
              onClick={signOut}
            >
              <span className="rail-collapsed:sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      {/* DESKTOP SIDEBAR */}
      {/* studio-rail: target of the rail-collapsed variant */}
      <aside className="studio-rail fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface glass-soft transition-[width] duration-200 lg:block rail-collapsed:w-16">
        {renderNav()}
      </aside>

      {/* MOBILE DRAWER */}
      {navOpen && <MobileDrawer onClose={closeNav}>{renderNav()}</MobileDrawer>}

      {/* Column: top bar, page, then the footer at the very
          bottom (pushed down on short pages) */}
      <div className="flex min-h-screen flex-col transition-[padding] duration-200 lg:pl-60 lg:sidebar-collapsed:pl-16">
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/40 px-4 glass-soft lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon="menu"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
              className="lg:hidden"
            />
            <SidebarToggle />

            {/* Phones: where am I. Desktop: a welcome (the
                heading and active nav already say the page) */}
            <p className="truncate text-sm font-medium text-fg-muted lg:hidden">
              {pageTitle}
            </p>

            <div className="hidden min-w-0 lg:block">
              <Greeting name={currentUser.name} />
            </div>
          </div>

          <SessionTimer startedAt={sessionStartedAt} />
        </header>

        <main
          id="main-content"
          className="flex-1 px-4 py-6 lg:px-6 lg:py-6"
        >
          {children}
        </main>

        <AppFooter />
      </div>
    </div>
  );
}

// Navigation drawer for small screens (a modal dialog)
function MobileDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useDialog(panel, onClose);

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
    >
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={-1}
        className="ui-backdrop absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        ref={panel}
        className="glass relative h-full w-72 max-w-[85vw] border-r"
      >
        <Button
          size="sm"
          variant="ghost"
          icon="close"
          aria-label="Close navigation"
          data-autofocus
          onClick={onClose}
          className="absolute right-2 top-3"
        />
        {children}
      </aside>
    </div>
  );
}

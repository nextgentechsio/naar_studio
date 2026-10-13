"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/app/components/ui/primitives";

// --------------------------------------------------
// SIDEBAR TOGGLE (desktop)
//
// Collapses the sidebar to an icon rail so pages get the
// full width. The state lives in data-sidebar on <html>
// (styled by the sidebar-collapsed / rail-collapsed CSS
// variants) and in localStorage; app/layout.tsx applies
// it before first paint.
// --------------------------------------------------

const EVENT = "sidebarchange";

function isCollapsed() {
  return document.documentElement.dataset.sidebar === "collapsed";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export default function SidebarToggle() {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);

  function toggle() {
    const next = !isCollapsed();
    const root = document.documentElement;

    if (next) root.dataset.sidebar = "collapsed";
    else delete root.dataset.sidebar;

    try {
      if (next) localStorage.setItem("sidebar", "collapsed");
      else localStorage.removeItem("sidebar");
    } catch {
      // Storage unavailable: still applies for this visit
    }

    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      icon="sidebar"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={toggle}
      className="hidden lg:inline-flex"
    />
  );
}

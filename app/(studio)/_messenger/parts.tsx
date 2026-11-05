"use client";

import { cx } from "@/app/components/ui/primitives";

// --------------------------------------------------
// MESSENGER: small shared pieces
// --------------------------------------------------

// A steady colour per person, from their id
function hue(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function Avatar({
  id,
  name,
  size = 36,
  className,
}: {
  id: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const h = hue(id);

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(145deg, hsl(${h} 70% 62%), hsl(${(h + 40) % 360} 60% 42%))`,
      }}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.2)]",
        className,
      )}
    >
      {initials}
    </span>
  );
}

// A group: two of its members' faces, overlapped
export function GroupAvatar({ members, size = 36 }: { members: { id: string; name: string }[]; size?: number }) {
  const [first, second] = members;
  const small = Math.round(size * 0.62);
  if (!first) return <Avatar id="group" name="Group" size={size} />;
  if (!second) return <Avatar id={first.id} name={first.name} size={size} />;
  return (
    <span aria-hidden className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar id={first.id} name={first.name} size={small} className="absolute left-0 top-0" />
      <Avatar id={second.id} name={second.name} size={small} className="absolute bottom-0 right-0 ring-2 ring-[var(--canvas)]" />
    </span>
  );
}

export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-none text-white shadow-[0_0_0_2px_var(--canvas,white)]",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// "7:28 PM" today; "Mon 7:28 PM" this week; "4 Nov" before
export function shortTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (now.getTime() - date.getTime() < 6 * 24 * 3600 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// The divider between messages far apart in time
export function dividerTime(iso: string) {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(
    undefined,
    today
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  );
}

import { Icon, type IconName } from "@/app/components/ui/Icon";

// --------------------------------------------------
// Naar Cuts' own icons (same 24px grid and stroke as the
// studio's Icon), kept here so the shared set only gains
// what the rest of the app shows (film, scissors).
// --------------------------------------------------

const CUT_PATHS = {
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  skipBack: "M19 20L9 12l10-8v16zM5 19V5",
  skipForward: "M5 4l10 8-10 8V4zM19 5v14",
  frame: "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M8 8h8v8H8z",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3H6zM6 7h4M14 7h4",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  plus: "M12 5v14M5 12h14",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.8-1.2",
  volume: "M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  mute: "M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6",
  cursor: "M4 3l7.1 17 2.5-7.4L21 10.1 4 3z",
  wand: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5",
  layers: "M12 2l10 5-10 5L2 7l10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  diamond: "M12 2l10 10-10 10L2 12 12 2z",
  split: "M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4",
  copy2: "M8 8h12v12H8zM4 16V4h12",
  zoomIn: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6",
  zoomOut: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6",
  marker: "M5 3h14v13l-7 5-7-5V3z",
  palette: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01",
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  square: "M4 4h16v16H4z",
  detach: "M4 7h10v6H4zM10 17h10M17 14l3 3-3 3",
  speed: "M12 14l4-4M3.3 14a9 9 0 1 1 17.4 0",
} as const;

export type CutIconName = keyof typeof CUT_PATHS | IconName;

export function CutIcon({ name, size = 16, className = "" }: { name: CutIconName; size?: number; className?: string }) {
  if (!(name in CUT_PATHS)) return <Icon name={name as IconName} size={size} className={className} />;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path d={CUT_PATHS[name as keyof typeof CUT_PATHS]} />
    </svg>
  );
}

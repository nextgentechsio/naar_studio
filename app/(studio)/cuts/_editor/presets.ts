import type { ColorLook, TextStyle, Transform, TransitionType } from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: READY-MADE TITLES, TRANSITIONS AND LOOKS
// (shown in the media pool, dragged onto the timeline)
// --------------------------------------------------

export type TitlePreset = {
  id: string;
  name: string;
  text: Partial<TextStyle>;
  transform?: Partial<Transform>;
  seconds: number;
};

export const TITLE_PRESETS: TitlePreset[] = [
  { id: "title", name: "Title", text: { text: "Your title", size: 0.11, weight: 800, animation: "rise" }, seconds: 4 },
  {
    id: "lower-third",
    name: "Lower third",
    text: { text: "Name Surname\nRole", size: 0.045, weight: 600, align: "left", background: "rgba(0,0,0,0.55)", animation: "rise", shadow: false },
    transform: { x: -0.28, y: 0.32 },
    seconds: 5,
  },
  {
    id: "subtitle",
    name: "Subtitle",
    text: { text: "Subtitle line", size: 0.05, weight: 600, background: "rgba(0,0,0,0.6)", animation: "fade", shadow: false },
    transform: { y: 0.38 },
    seconds: 3,
  },
  { id: "punch", name: "Punch", text: { text: "WOW", size: 0.2, weight: 900, stroke: 0.08, animation: "pop" }, seconds: 2 },
  { id: "typewriter", name: "Typewriter", text: { text: "Once upon a time…", size: 0.06, weight: 500, font: "ui-monospace, Menlo, monospace", animation: "typewriter" }, seconds: 4 },
  { id: "quote", name: "Quote", text: { text: "“Make it simple.”", size: 0.075, weight: 400, font: "Georgia, serif", animation: "fade" }, seconds: 4 },
];

export const TRANSITIONS: { type: TransitionType; name: string }[] = [
  { type: "dissolve", name: "Cross dissolve" },
  { type: "dip-black", name: "Dip to black" },
  { type: "dip-white", name: "Dip to white" },
  { type: "wipe-left", name: "Wipe" },
  { type: "slide-left", name: "Slide" },
  { type: "zoom", name: "Zoom" },
];

export const LOOKS: { look: ColorLook; swatch: string }[] = [
  { look: "teal-orange", swatch: "linear-gradient(135deg,#0f6e78,#f08a3c)" },
  { look: "warm-film", swatch: "linear-gradient(135deg,#7a4b2a,#f3c58a)" },
  { look: "cool-night", swatch: "linear-gradient(135deg,#0b1f4a,#6aa8ff)" },
  { look: "mono", swatch: "linear-gradient(135deg,#111,#ddd)" },
  { look: "faded", swatch: "linear-gradient(135deg,#6b6f7a,#d9d4cc)" },
  { look: "vivid", swatch: "linear-gradient(135deg,#ff2e63,#2effc4)" },
];

export const SOLID_COLORS = ["#000000", "#ffffff", "#101014", "#2fd6c8", "#7c5cff", "#ff4d6d"];

// Frame shapes offered in project settings, and where
// each is used. Resolution (720p to 4K) is picked when
// exporting, so the project only sets the shape.
export const ASPECTS: { name: string; use: string; width: number; height: number }[] = [
  { name: "16:9", use: "YouTube, TV", width: 1920, height: 1080 },
  { name: "9:16", use: "Reels, TikTok, Shorts", width: 1080, height: 1920 },
  { name: "1:1", use: "Square post", width: 1080, height: 1080 },
  { name: "4:5", use: "Instagram feed", width: 1080, height: 1350 },
  { name: "21:9", use: "Cinematic", width: 2560, height: 1080 },
];

export const FRAME_RATES = [24, 25, 30, 50, 60];

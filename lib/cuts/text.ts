import type { TextStyle } from "@/lib/cuts/timeline";

// --------------------------------------------------
// NAAR CUTS: TITLES
//
// A title drawn on a transparent canvas the size of the
// frame, centred; the compositor then moves, scales and
// fades it like any other layer.
// --------------------------------------------------

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawText(
  context: Canvas2D,
  width: number,
  height: number,
  style: TextStyle & { visibleChars: number }
) {
  context.clearRect(0, 0, width, height);

  const shown = [...style.text].slice(0, style.visibleChars).join("");
  if (!shown.trim()) return;

  const fontSize = Math.max(8, style.size * height);
  const lineHeight = fontSize * 1.18;
  context.font = `${style.weight} ${fontSize}px ${style.font}`;
  context.textBaseline = "middle";
  context.textAlign = style.align;

  const lines = shown.split("\n");
  const widths = lines.map((line) => context.measureText(line).width);
  const blockWidth = Math.max(...widths);
  const blockHeight = lines.length * lineHeight;
  const anchorX = style.align === "left" ? (width - blockWidth) / 2 : style.align === "right" ? (width + blockWidth) / 2 : width / 2;
  const top = (height - blockHeight) / 2;

  if (style.background) {
    const padX = fontSize * 0.45;
    const padY = fontSize * 0.25;
    context.fillStyle = style.background;
    const left = (width - blockWidth) / 2 - padX;
    roundRect(context, left, top - padY, blockWidth + padX * 2, blockHeight + padY * 2, fontSize * 0.22);
    context.fill();
  }

  if (style.shadow) {
    context.shadowColor = "rgba(0,0,0,0.55)";
    context.shadowBlur = fontSize * 0.25;
    context.shadowOffsetY = fontSize * 0.06;
  }

  lines.forEach((line, index) => {
    const y = top + lineHeight * (index + 0.5);

    if (style.stroke > 0) {
      context.lineJoin = "round";
      context.lineWidth = style.stroke * fontSize;
      context.strokeStyle = style.strokeColor;
      context.strokeText(line, anchorX, y);
    }
    context.fillStyle = style.color;
    context.fillText(line, anchorX, y);
  });

  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
}

function roundRect(context: Canvas2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

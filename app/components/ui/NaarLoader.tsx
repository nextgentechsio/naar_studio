"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// --------------------------------------------------
// NAAR LOADER
//
// A solid 3D "n" from the NAAR wordmark turns to follow
// the mouse cursor (and sways gently on its own when the
// mouse is idle or on touch screens). Click (or touch)
// and drag to spin it; it settles back facing front.
//   orbit: while a generation runs, the logo's two cyan
//          balls circle the n in 3D (in front, behind).
//   land:  when the result is ready, each ball flies in
//          an arc from where it is to its spot (below the
//          left stem, like the dots in the wordmark, and on
//          the tail) and rests there for 2 seconds before
//          the output is shown.
// Keyframes live in globals.css under "NAAR LOADER".
// People who prefer reduced motion get a still version.
// --------------------------------------------------

// The "n" glyph, cut from the wordmark in NaarLogo.tsx
const N_GLYPH =
  "M22.5602 19.7341C22.271 20.1192 22.1345 20.6279 22.1345 21.2454C22.1767 22.9388 21.2994 24.4095 19.7298 24.3787C12.8115 24.2389 20.2904 6.45036 13.3135 3.09287C11.0535 2.00566 7.96798 2.11942 6.20996 4.48072C6.16934 3.95093 6.59991 2.45257 5.70141 2.43307C4.91501 2.44607 4.60468 3.30088 3.6948 3.76567C2.52657 4.36208 1.5452 4.53272 0.698691 4.96175C-0.295678 5.36641 -0.0828311 6.45523 0.643448 6.83064C1.37948 7.27267 1.61994 7.79921 1.59232 8.89291V8.83928L1.5907 14.9855C1.5777 15.7022 1.48021 16.1816 1.27386 16.4855C1.06752 16.8024 0.846546 17.0364 0.612577 17.1875C0.433851 17.311 0.297369 17.4362 0.185258 17.5727C0.0569004 17.7287 -0.00159187 17.9139 3.29108e-05 18.1918C3.29108e-05 18.3852 0.0893961 18.5364 0.240501 18.6599C0.391606 18.7834 0.695441 18.8386 1.13576 18.8386H6.67303C7.12797 18.8386 7.43018 18.7834 7.58291 18.6599C7.73401 18.5364 7.8185 18.3673 7.82663 18.174C7.838 17.9091 7.75514 17.7173 7.63815 17.571C7.52117 17.4264 7.37656 17.3094 7.21083 17.1859C6.97686 17.0348 6.75589 16.8007 6.54954 16.4838C6.3432 16.1816 6.23271 15.7005 6.21971 14.9839C6.21971 14.9839 6.20184 8.12261 7.03535 5.81331C7.66577 4.06469 9.77799 3.33501 10.8552 4.81062C11.2533 5.37453 11.5149 6.11558 11.6384 7.06465C11.9536 9.13343 11.8285 16.6415 11.8577 18.8809C11.8512 21.0553 12.6279 22.8527 14.2754 24.104C17.0895 26.137 21.3611 26.4751 24.3052 24.3933C25.4214 23.6181 26.4402 22.4415 26.4353 21.0829C26.6091 18.8874 23.7479 18.0326 22.5602 19.7357";

// Back layers that give the letter its solid depth (8px):
// thin and close, so it stays solid even edge-on mid-spin
const DEPTH_LAYERS = 24;
const DEPTH_PX = 8;

// Flight from the orbit to the landing spot
const NAAR_LOADER_FLIGHT_MS = 650;
// Flight, then the balls rest on their spots for 2 seconds
// before the output is shown
export const NAAR_LOADER_LAND_MS = NAAR_LOADER_FLIGHT_MS + 2000;

const SPOTS = ["below", "tail"] as const;

// Cursor following
const FOLLOW_RANGE_PX = { x: 360, y: 300 }; // cursor offset for full tilt
const IDLE_AFTER_MS = 2500; // then sway on its own
const SWAY_PERIOD_MS = 10_000; // one full left-right-left sway
const EASE = 0.08; // share of the remaining distance per frame

// Drag to spin
const DRAG_DEG_PER_PX = 0.6;
const MAX_DRAG_TILT = 50; // deg, up/down
const SPIN_FRICTION = 0.95; // momentum kept per frame

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function NaarLoader({
  phase = "orbit",
  label = "Generating",
}: {
  phase?: "orbit" | "land";
  label?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const orbiters = useRef<(HTMLSpanElement | null)[]>([]);

  // Follow the cursor: where it is relative to the loader
  // becomes --tx / --ty (-1…1) on the stage, eased every
  // frame; the CSS turns the letter (and tilts the orbit)
  // from them. Drag to spin: --spin-x / --spin-y (deg) are
  // added on top, keep spinning with momentum on release,
  // then settle back facing front. No React state, so
  // nothing re-renders.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let lastMove = -Infinity;
    let frame = 0;

    const spin = { x: 0, y: 0, velocity: 0 };
    let drag: { id: number; x: number; y: number } | null = null;

    const onMove = (event: PointerEvent) => {
      if (drag || event.pointerType === "touch") return;
      const box = element.getBoundingClientRect();
      target = {
        x: clamp(
          (event.clientX - (box.left + box.width / 2)) / FOLLOW_RANGE_PX.x,
        ),
        y: clamp(
          (event.clientY - (box.top + box.height / 2)) / FOLLOW_RANGE_PX.y,
        ),
      };
      lastMove = performance.now();
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      spin.velocity = 0;
      element.dataset.dragging = "true";
    };

    const onDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;

      spin.x += dx * DRAG_DEG_PER_PX;
      spin.y = Math.max(
        -MAX_DRAG_TILT,
        Math.min(MAX_DRAG_TILT, spin.y - dy * DRAG_DEG_PER_PX),
      );
      spin.velocity = dx * DRAG_DEG_PER_PX;
      lastMove = performance.now();
    };

    const onUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      delete element.dataset.dragging;
      lastMove = performance.now();
    };

    const tick = (now: number) => {
      const goal =
        now - lastMove > IDLE_AFTER_MS
          ? { x: 0.8 * Math.sin((now / SWAY_PERIOD_MS) * 2 * Math.PI), y: 0 }
          : target;

      current.x += (goal.x - current.x) * EASE;
      current.y += (goal.y - current.y) * EASE;

      if (!drag) {
        // Momentum, then settle on the nearest full turn
        // (facing front) and level out
        if (Math.abs(spin.velocity) > 0.05) {
          spin.x += spin.velocity;
          spin.velocity *= SPIN_FRICTION;
        } else {
          spin.velocity = 0;
          spin.x += (Math.round(spin.x / 360) * 360 - spin.x) * EASE;
        }
        spin.y += (0 - spin.y) * EASE;
      }

      element.style.setProperty("--tx", current.x.toFixed(4));
      element.style.setProperty("--ty", current.y.toFixed(4));
      element.style.setProperty("--spin-x", `${spin.x.toFixed(2)}deg`);
      element.style.setProperty("--spin-y", `${spin.y.toFixed(2)}deg`);

      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onDrag);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onDrag);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(frame);
    };
  }, []);
  const fliers = useRef<(HTMLSpanElement | null)[]>([]);

  // Landing: fly each ball from where it is in its orbit
  // (the orbit is paused, not removed, so it can still be
  // measured) to its spot, in an arc
  useLayoutEffect(() => {
    if (phase !== "land") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    fliers.current.forEach((flier, index) => {
      const from = orbiters.current[index]?.getBoundingClientRect();
      if (!flier || !from) return;

      const to = flier.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);

      flier.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          {
            transform: `translate(${dx * 0.35}px, ${Math.min(dy, 0) - 40}px)`,
            offset: 0.55,
          },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: NAAR_LOADER_FLIGHT_MS,
          easing: "cubic-bezier(0.3, 0.6, 0.4, 1)",
        },
      );
    });
  }, [phase]);

  return (
    <div
      role="status"
      aria-label={label}
      className="naar-loader"
      data-phase={phase}
    >
      <div ref={stage} className="naar-loader__stage" aria-hidden>
        <span className="naar-loader__floor" />

        {/* The letter (and the landing spots) turn together */}
        <div className="naar-loader__figure">
          {Array.from({ length: DEPTH_LAYERS }, (_, index) => (
            <svg
              key={index}
              className="naar-loader__layer naar-loader__layer--side"
              style={{
                transform: `translateZ(${(-(index + 1) * DEPTH_PX) / DEPTH_LAYERS}px)`,
              }}
              viewBox="-0.5 1.5 27.5 25.5"
              fill="currentColor"
            >
              <path d={N_GLYPH} />
            </svg>
          ))}
          <svg
            className="naar-loader__layer"
            viewBox="-0.5 1.5 27.5 25.5"
            fill="currentColor"
          >
            <path d={N_GLYPH} />
          </svg>

          {/* Landing spots: below the left stem, and on the
              tail (percentages of the letter's box) */}
          {SPOTS.map((spot, index) => (
            <span
              key={spot}
              className={`naar-loader__spot naar-loader__spot--${spot}`}
            >
              <span
                ref={(element) => {
                  fliers.current[index] = element;
                }}
                className="naar-loader__flier"
              >
                {/* Turned back against the letter's turn, so
                    the ball always faces the viewer as a
                    round sphere */}
                <span className="naar-loader__face">
                  <span className="naar-loader__ball" />
                </span>
              </span>
            </span>
          ))}
        </div>

        {/* Orbit around the letter while generating */}
        <div className="naar-loader__orbit">
          {SPOTS.map((spot, index) => (
            <span
              key={spot}
              className={`naar-loader__orbiter naar-loader__orbiter--${index}`}
            >
              <span
                ref={(element) => {
                  orbiters.current[index] = element;
                }}
                className="naar-loader__ball naar-loader__ball--orbit"
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

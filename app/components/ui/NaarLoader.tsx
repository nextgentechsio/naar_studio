"use client";

import { useLayoutEffect, useRef } from "react";

// --------------------------------------------------
// NAAR LOADER
//
// A solid 3D "n" from the NAAR wordmark slowly turns.
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

// Back layers that give the letter its solid depth
const DEPTH_LAYERS = 8;

// Flight from the orbit to the landing spot
export const NAAR_LOADER_FLIGHT_MS = 650;
// Flight, then the balls rest on their spots for 2 seconds
// before the output is shown
export const NAAR_LOADER_LAND_MS = NAAR_LOADER_FLIGHT_MS + 2000;

const SPOTS = ["below", "tail"] as const;

export function NaarLoader({
  phase = "orbit",
  label = "Generating",
}: {
  phase?: "orbit" | "land";
  label?: string;
}) {
  const orbiters = useRef<(HTMLSpanElement | null)[]>([]);
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
      <div className="naar-loader__stage" aria-hidden>
        <span className="naar-loader__floor" />

        {/* The letter (and the landing spots) turn together */}
        <div className="naar-loader__figure">
          {Array.from({ length: DEPTH_LAYERS }, (_, index) => (
            <svg
              key={index}
              className="naar-loader__layer naar-loader__layer--side"
              style={{ transform: `translateZ(${-(index + 1)}px)` }}
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
                <span className="naar-loader__ball" />
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

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { playTick } from "@/lib/cinema-studio-4/tick-sound";

/**
 * Generic drag/wheel/keyboard ruler-stepper — currently used by Era only.
 * Geometry matches the reference exactly: 16.8px minor-tick spacing, a
 * major tick (thicker) every 10th, 168px between selectable items (=10
 * ticks). Position is index-based (items[selectedIndex] === value), not
 * pixel-based, so the caller's value/onChange contract stays a plain enum.
 *
 * Cyclic, not clamped: confirmed live against the reference (dragging past
 * the last item wraps to the first — "Auto" sits directly between "2020s"
 * and "1960s"), so each item's render offset is computed via the same
 * shortest-path-wraparound-from-a-continuous-position technique GenreArc/
 * TempoCarousel already use (see AGENTS.md's Cinema Studio 4.0 lock note),
 * just extended to a fractional live position instead of an integer one so
 * it can track a continuous drag/wheel gesture, not just discrete steps.
 *
 * This project's own accent (#D97757, see ACCENT in
 * CinemaStudio40CreativeControls.tsx) is used for the pin/selected label
 * instead of the reference's lime green (#CDFF3A / rgb(209,254,23)) — the
 * project deliberately keeps its own accent distinct from the reference's
 * (see AGENTS.md's Cinema Studio 4.0 lock note), and mixing the reference's
 * color into just this one control would break consistency with every
 * other selected-state indicator in the same panel.
 *
 * Tick sound: instrumenting the reference's own AudioBufferSourceNode
 * calls while dragging its Era ruler showed every tick plays the same
 * short sample with only `playbackRate` varying (observed clamped to
 * roughly 0.85–1.5, rising and falling with drag speed) — there is no
 * separate "major"/"settle" sound, and Prev/Next or direct label clicks
 * play nothing at all. Reproduced here as a velocity-derived `rate` passed
 * to playTick() only from actual drag/wheel motion; step()/jumpTo() (and
 * therefore Prev/Next, label clicks, keyboard, and the release/settle
 * moment itself) stay silent to match.
 */

const ACCENT = "#D97757";
const TICK_GAP = 16.8; // px between minor ticks
const TICKS_PER_ITEM = 10; // = 168px / 16.8px
const ITEM_GAP = TICK_GAP * TICKS_PER_ITEM; // 168px between selectable items
const SNAP_MS = 180;
const MASK = "linear-gradient(90deg,transparent 0%,black 18%,black 82%,transparent 100%)";
const WHEEL_SETTLE_MS = 150;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Shortest-path fold of a raw item-index distance into (-count/2, count/2]. */
function wrapDistance(raw: number, count: number) {
  let d = raw % count;
  if (d > count / 2) d -= count;
  if (d < -count / 2) d += count;
  return d;
}

interface RulerScrubberProps {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}

export default function RulerScrubber({ items, value, onChange, label }: RulerScrubberProps) {
  const count = items.length;
  const selectedIndex = Math.max(0, items.indexOf(value));

  // dragPx is a transient, UNBOUNDED offset on top of the committed
  // index's position — 0 whenever nothing is actively being dragged/
  // wheeled. dragPxRef mirrors it so the wheel-settle timeout can read the
  // latest value without nesting a setState call inside another
  // setState's updater (that produced a real "Cannot update a component
  // while rendering a different component" error when commitOffset —
  // which calls the parent's onChange — was called from inside a
  // setDragPx updater function).
  const [dragPx, setDragPx] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const dragPxRef = useRef(0);
  const dragStartRef = useRef<{ pointerId: number; startX: number; baseOffset: number } | null>(null);
  const lastTickUnitRef = useRef(0);
  const lastMoveRef = useRef<{ t: number; px: number } | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDrag = (px: number) => {
    dragPxRef.current = px;
    setDragPx(px);
  };

  const baseOffset = -selectedIndex * ITEM_GAP;
  const livePosition = selectedIndex - dragPx / ITEM_GAP; // continuous fractional index, unbounded
  const totalTickSlots = count * TICKS_PER_ITEM;

  // Velocity (px/ms) → a playbackRate-style pitch multiplier, matching the
  // ~0.85–1.5 range observed on the reference; playTick() clamps too, this
  // just keeps the mapping legible at the call site.
  const rateFromVelocity = (pxPerMs: number) => {
    const t = Math.min(1, Math.abs(pxPerMs) / 1.2);
    return 0.85 + t * (1.5 - 0.85);
  };

  const emitTicksFor = (offset: number, now: number) => {
    const unit = Math.round(-offset / TICK_GAP);
    if (unit !== lastTickUnitRef.current) {
      lastTickUnitRef.current = unit;
      const last = lastMoveRef.current;
      const pxPerMs = last && now > last.t ? (offset - last.px) / (now - last.t) : 0;
      playTick(rateFromVelocity(pxPerMs));
    }
    lastMoveRef.current = { t: now, px: offset };
  };

  const commitOffset = (finalOffset: number) => {
    const rawIndex = Math.round(-finalOffset / ITEM_GAP);
    const nearest = ((rawIndex % count) + count) % count;
    setDrag(0);
    setIsInteracting(false);
    lastMoveRef.current = null;
    if (items[nearest] !== value) onChange(items[nearest]);
  };

  const step = (delta: number) => {
    const next = ((selectedIndex + delta) % count + count) % count;
    if (items[next] !== value) onChange(items[next]);
  };

  const jumpTo = (index: number) => {
    const wrapped = ((index % count) + count) % count;
    if (items[wrapped] !== value) onChange(items[wrapped]);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active native pointer session (e.g. synthetic/test events) — drag still works via bubbled move/up */
    }
    dragStartRef.current = { pointerId: e.pointerId, startX: e.clientX, baseOffset };
    lastTickUnitRef.current = Math.round(-baseOffset / TICK_GAP);
    lastMoveRef.current = { t: e.timeStamp, px: baseOffset };
    setIsInteracting(true);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = e.clientX - drag.startX;
    setDrag(delta);
    emitTicksFor(drag.baseOffset + delta, e.timeStamp);
  };
  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStartRef.current = null;
    commitOffset(drag.baseOffset + (e.clientX - drag.startX));
  };

  // No e.preventDefault() here — React can register wheel listeners as
  // passive, which throws "Unable to preventDefault inside passive event
  // listener invocation" (reproduced live). The shared useWheelStep hook
  // used by Genre/Tempo has the same characteristic and doesn't call it
  // either; the dialog content isn't scrollable at this spot so nothing
  // is lost by not blocking the native scroll.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setIsInteracting(true);
    const next = dragPxRef.current - delta;
    emitTicksFor(baseOffset + next, e.timeStamp);
    setDrag(next);
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      commitOffset(baseOffset + dragPxRef.current);
    }, WHEEL_SETTLE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "Home") {
      e.preventDefault();
      jumpTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      jumpTo(count - 1);
    }
  };

  useEffect(
    () => () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  const transition = isInteracting || prefersReducedMotion() ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1)`;

  return (
    <>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={selectedIndex}
        aria-valuetext={value}
        className="relative mb-1 h-8 w-full shrink-0 touch-none cursor-grab overflow-hidden outline-none active:cursor-grabbing"
        style={{ maskImage: MASK, WebkitMaskImage: MASK } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 4, height: 32, background: ACCENT }}
        />
        {Array.from({ length: totalTickSlots }, (_, s) => {
          // Cyclic like the labels below — a fixed-window tick strip ran out
          // of decoration once selectedIndex got far enough from 0 (e.g. at
          // "Auto", the last item) and rendered a blank stretch of ruler.
          // Every tick is instead positioned every render via the same
          // shortest-path-wraparound-from-a-continuous-position technique.
          const d = wrapDistance(s - livePosition * TICKS_PER_ITEM, totalTickSlots);
          const big = s % TICKS_PER_ITEM === 0;
          return (
            <span
              key={s}
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 w-[2px] rounded-full bg-white/10"
              style={{
                transform: `translate(calc(-50% + ${d * TICK_GAP}px), -50%)`,
                transition: transition === "none" ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1)`,
                height: big ? 24 : 16,
              }}
            />
          );
        })}
      </div>

      <div className="relative mt-3 h-10 w-full">
        <div className="absolute inset-0 overflow-hidden" style={{ maskImage: MASK, WebkitMaskImage: MASK } as React.CSSProperties}>
          {items.map((item, i) => {
            const d = wrapDistance(i - livePosition, count);
            const isSelected = Math.abs(d) < 0.5;
            return (
              <button
                key={item}
                type="button"
                onClick={() => jumpTo(i)}
                className="absolute left-1/2 top-1/2 cursor-pointer whitespace-nowrap border-none bg-transparent p-0 text-lg font-semibold leading-6"
                style={{
                  // Position and scale are kept as two separate transforms on
                  // two nested elements rather than combined in one
                  // translate(...) scale(...) value — composing both on the
                  // same element clipped the scaled-up selected label's top
                  // against the mask/overflow wrapper (measured ~11px of
                  // real clipping live), because the translate-then-scale
                  // composition doesn't keep the box centered on itself the
                  // way two independent transforms do.
                  transform: `translate(calc(-50% + ${d * ITEM_GAP}px), -50%)`,
                  transition: transition === "none" ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1)`,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    transform: `scale(${isSelected ? 1.55556 : 1})`,
                    transition: transition === "none" ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1), color ${SNAP_MS}ms cubic-bezier(0.22,1,0.36,1)`,
                    opacity: isSelected ? 1 : 0.7,
                    color: isSelected ? ACCENT : "rgb(130,130,130)",
                  }}
                >
                  {item}
                </span>
              </button>
            );
          })}
        </div>
        <div className="absolute left-[calc(50%-76px)] top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label={`Previous ${label}`}
            onClick={() => step(-1)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/10 transition-colors duration-150 hover:bg-white/15 active:scale-[0.96]"
          >
            <ChevronLeft className="size-3.5 text-white" strokeWidth={1.5} />
          </button>
        </div>
        <div className="absolute left-[calc(50%+76px)] top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <button
            type="button"
            aria-label={`Next ${label}`}
            onClick={() => step(1)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/10 transition-colors duration-150 hover:bg-white/15 active:scale-[0.96]"
          >
            <ChevronRight className="size-3.5 text-white" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface WheelItemState {
  active: boolean;
  opacity: number;
  scale: number;
}

interface WheelProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /** Maps distance-from-selected → visual state. */
  fade: (distance: number) => { opacity: number; scale: number };
  renderItem: (option: string, state: WheelItemState) => ReactNode;
  gapClass?: string;
  className?: string;
}

/**
 * Vertical wheel/carousel picker: the selected item is centered + fully opaque,
 * neighbours fade and shrink by distance. Hidden scrollbar, gradient edges.
 */
export default function Wheel({
  options,
  value,
  onChange,
  fade,
  renderItem,
  gapClass = "gap-4",
  className = "",
}: WheelProps) {
  const selectedIndex = Math.max(0, options.indexOf(value));
  const activeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Vertical slack (in px) needed above/below the items so the first and
  // last options can still scroll all the way to the center slot. Percentage
  // padding (e.g. `py-[45%]`) can't do this: per the CSS spec, percentage
  // padding-top/bottom resolves against the containing block's *width*, not
  // its height, so it silently produces the wrong slack for any column
  // that isn't roughly square. Measuring the real pixel height fixes that
  // for every consumer (Genre, Camera, Style) regardless of its aspect ratio.
  const [slack, setSlack] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setSlack(el.clientHeight / 2);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Center the selected item. `scrollIntoView({block:'center'})` is not used
  // here — across nested scroll ancestors and rapid slack/index updates it
  // was unreliable (observed leaving scrollTop at 0, landing the active
  // item's *top* edge on the center line instead of its actual center). We
  // compute the exact scrollTop instead: this is what places the active
  // icon's geometric center exactly on the card's center, deterministically.
  useEffect(() => {
    const el = scrollRef.current;
    const btn = activeRef.current;
    if (!el || !btn || slack === 0) return;
    const target =
      btn.offsetTop + btn.offsetHeight / 2 - el.clientHeight / 2;
    el.scrollTop = target;
  }, [selectedIndex, slack]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Top fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[#1a1d1f] to-transparent" />

      <div
        ref={scrollRef}
        className="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className={`flex flex-col items-center ${gapClass}`}
          style={{ paddingTop: slack, paddingBottom: slack }}
        >
          {options.map((opt, i) => {
            const distance = Math.abs(i - selectedIndex);
            const active = distance === 0;
            const { opacity, scale } = fade(distance);
            return (
              <button
                key={opt}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onChange(opt)}
                aria-pressed={active}
                className="shrink-0 transition-all duration-200 ease-out focus:outline-none active:scale-95"
                style={{ opacity, transform: `scale(${scale})` }}
              >
                {renderItem(opt, { active, opacity, scale })}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-[#1a1d1f] to-transparent" />
    </div>
  );
}

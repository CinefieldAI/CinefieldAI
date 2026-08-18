"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HERO_CARDS_DATA } from "./heroCardsData";

export default function HeroCarousel() {
  // The DIV wrapping the <ul> is the actual scroll container
  // (`overflow-x-scroll` lives here per the reference markup) — the <ul>
  // itself has no overflow property, so scrolling must be driven from this
  // ref, not one on the <ul>.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    return () => window.removeEventListener("resize", updateScrollState);
  }, [updateScrollState]);

  const scrollByCard = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div ref={scrollerRef} onScroll={updateScrollState} className="hide-scrollbar grid min-w-0 overflow-x-scroll px-4">
        <ul className="flex min-w-0 gap-5 *:flex-[0_0_19.5rem] md:*:flex-[0_0_25rem] xl:*:flex-[0_0_32rem]">
          {HERO_CARDS_DATA.map((card) => (
            <li key={card.id}>
              <div className="group relative grid grid-flow-row-dense gap-3 rounded-lg transition active:brightness-75">
                {card.href && (
                  <a
                    href={card.href}
                    aria-label={`Open ${card.title} in 1080p`}
                    className="absolute inset-0 z-10 hidden md:block"
                  >
                    <span className="sr-only">Open {card.title} in 1080p</span>
                  </a>
                )}
                {card.href && (
                  <a
                    href={card.href}
                    aria-label={`Open ${card.title} in 1080p`}
                    className="absolute inset-0 z-10 md:hidden"
                  >
                    <span className="sr-only">Open {card.title} in 1080p</span>
                  </a>
                )}
                <figure
                  style={{ aspectRatio: "1.7777777777777777" }}
                  className="relative overflow-hidden rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02]"
                >
                  {card.videoSrc ? (
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      disablePictureInPicture
                      preload="none"
                      src={card.videoSrc}
                      className="size-full object-cover"
                      aria-label={`${card.title} - ${card.subtitle}`}
                    >
                      Your browser does not support the video.
                    </video>
                  ) : null}
                  <div className="pointer-events-none absolute inset-0 rounded-lg shadow-[-0.5px_-0.5px_1px_0_rgba(255,255,255,0.12)_inset,0.8px_0.5px_0.5px_0_rgba(27,27,27,0.17)_inset]" />
                </figure>
                <div className="grid grid-rows-2 text-left">
                  <h3 className="truncate text-sm font-bold uppercase tracking-wide text-white/90">{card.title}</h3>
                  <p className="truncate text-xs text-white/50 xl:text-sm">{card.subtitle}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollByCard(-1)}
        disabled={!canScrollLeft}
        className={`absolute left-0 top-0 flex h-[calc(100%-2.75rem)] w-14 items-center justify-center bg-gradient-to-r from-black/70 to-transparent transition-opacity duration-150 ${
          canScrollLeft ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-lg text-white">‹</span>
      </button>

      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollByCard(1)}
        disabled={!canScrollRight}
        className={`absolute right-0 top-0 flex h-[calc(100%-2.75rem)] w-14 items-center justify-center bg-gradient-to-l from-black/70 to-transparent transition-opacity duration-150 ${
          canScrollRight ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-lg text-white">›</span>
      </button>
    </div>
  );
}

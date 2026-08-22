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
    <div className="group relative">
      {/* No horizontal padding of its own: the page container already pads,
          and a second inset here pushed the row 16px further in than every
          section below it. */}
      <div ref={scrollerRef} onScroll={updateScrollState} className="hide-scrollbar grid min-w-0 overflow-x-scroll">
        {/* Card widths are picked so the row lands just past a whole number
            of cards — the next one stays half-visible, which is what tells
            the eye the row scrolls. At the 1400px cap that works out to
            three full cards plus half of the fourth. */}
        <ul className="flex min-w-0 gap-5 *:flex-[0_0_19.5rem] md:*:flex-[0_0_21.5rem] xl:*:flex-[0_0_23rem]">
          {HERO_CARDS_DATA.map((card) => (
            <li key={card.id}>
              <div className="group/card relative grid grid-flow-row-dense gap-3 rounded-lg transition active:brightness-75">
                {card.href && (
                  <a
                    href={card.href}
                    aria-label={`Open ${card.title}`}
                    className="absolute inset-0 z-10 hidden md:block"
                  >
                    <span className="sr-only">Open {card.title}</span>
                  </a>
                )}
                {card.href && (
                  <a
                    href={card.href}
                    aria-label={`Open ${card.title}`}
                    className="absolute inset-0 z-10 md:hidden"
                  >
                    <span className="sr-only">Open {card.title}</span>
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

      {/* Side gradient overlays */}
      <div
        className={`pointer-events-none absolute bottom-10 left-0 top-0 z-20 w-28 bg-gradient-to-r from-black/80 to-transparent transition-opacity duration-200 ${
          canScrollLeft ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`pointer-events-none absolute bottom-10 right-0 top-0 z-20 w-28 bg-gradient-to-l from-black/80 to-transparent transition-opacity duration-200 ${
          canScrollRight ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Left button */}
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollByCard(-1)}
        disabled={!canScrollLeft}
        className={`absolute left-3 top-[calc(50%-1.25rem)] z-30 -translate-y-1/2 cursor-pointer rounded-full border border-white/15 bg-white/10 p-2.5 text-white backdrop-blur-2xl transition-all duration-200 hover:bg-white/25 hover:scale-105 active:scale-95 ${
          canScrollLeft ? "opacity-0 group-hover:opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-6">
          <path d="M13.7929 16L10.1464 12.3536C9.95118 12.1583 9.95118 11.8417 10.1464 11.6464L13.7929 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Right button */}
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollByCard(1)}
        disabled={!canScrollRight}
        className={`absolute right-3 top-[calc(50%-1.25rem)] z-30 -translate-y-1/2 cursor-pointer rounded-full border border-white/15 bg-white/10 p-2.5 text-white backdrop-blur-2xl transition-all duration-200 hover:bg-white/25 hover:scale-105 active:scale-95 ${
          canScrollRight ? "opacity-0 group-hover:opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-6">
          <path d="M10.2071 16L13.8536 12.3536C14.0488 12.1583 14.0488 11.8417 13.8536 11.6464L10.2071 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

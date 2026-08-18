"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hero carousel — layout/interaction cloned from the reference site's own
 * markup (flex-basis card sizing, aspect-ratio figure, inset shadow), but
 * the CONTENT is Cinefield's own: real supported models/features, not the
 * reference's own product-announcement copy or named individuals. Media is
 * a placeholder gradient until real files land under `public/explore/`.
 */

interface HeroCard {
  title: string;
  subtitle: string;
  videoSrc?: string;
  href?: string;
}

const HERO_CARDS: HeroCard[] = [
  {
    title: "Seedance 2.5",
    subtitle: "Now generating in 1080p on Cinefield.",
    videoSrc: "/Klon kopya fotos _videos/seedance_2_5_1080p.mp4",
    href: "https://higgsfield.ai/ai/video?model=seedance_2_5&resolution=1080p",
  },
  { title: "Marketing Studio", subtitle: "Ad-ready shorts and product creatives." },
  { title: "Create Image", subtitle: "Photoreal, illustrated, or stylized stills." },
  { title: "Create Video", subtitle: "Motion generation across every model." },
  { title: "Cinema Studio 4.0", subtitle: "More control. Longer scenes. Sharper quality." },
  { title: "MCP & CLI", subtitle: "Bring Cinefield into Claude, ChatGPT, and your terminal." },
  { title: "Layers", subtitle: "Decompose any image into editable layers." },
  { title: "Audio Studio", subtitle: "Voiceover, change voice, translate." },
  { title: "Supercomputer", subtitle: "Reasoning-first generation, beam by beam." },
  { title: "Shorts Studio", subtitle: "Vertical stories, cut for the feed." },
  { title: "Canvas", subtitle: "An infinite board for every generation." },
  { title: "Viral Presets", subtitle: "Trend-ready templates, one click away." },
  { title: "Explainer", subtitle: "Turn any idea into a narrated walkthrough." },
  { title: "Community", subtitle: "See what everyone else is building." },
];

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
          {HERO_CARDS.map((card) => (
            <li key={card.title}>
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

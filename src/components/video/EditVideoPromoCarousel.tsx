"use client";

import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

// Gradient stand-in for the reference's promo card media — the project
// deliberately does not download the reference's photography/video.
const PROMO_CARD_GRADIENT =
  "linear-gradient(135deg, #3a2a22 0%, #23201d 45%, #101113 100%)";

// The reference's Edit Video "How it works" view is a promo carousel of
// these six cards (only Relight & Atmosphere carries a description line).
const PROMO_CARDS: { title: string; description?: string }[] = [
  {
    title: "Relight & Atmosphere",
    description:
      "Change daytime to dusk or add cinematic lighting. The model understands 3D geometry to adjust light…",
  },
  { title: "Draw to Edit" },
  { title: "Precise Object Swap" },
  { title: "Re-frame & Composition" },
  { title: "Smart Clean Up" },
  { title: "Recolor & Restyle" },
];

export default function EditVideoPromoCarousel() {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollByCard = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const card = scroller.querySelector<HTMLElement>("[data-promo-card]");
    const step = card ? card.offsetWidth + 12 : 320;
    scroller.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  return (
    <section className="flex w-full flex-col rounded-[1.25rem] border border-white/[0.07] bg-[#181a1c] p-5 sm:p-8">
      <div className="mb-4 flex items-center justify-end gap-1.5">
        <button
          type="button"
          aria-label="Previous cards"
          onClick={() => scrollByCard(-1)}
          className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Next cards"
          onClick={() => scrollByCard(1)}
          className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {PROMO_CARDS.map((card) => (
          <figure
            key={card.title}
            data-promo-card
            className="relative aspect-[3/4] w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl sm:w-[300px]"
          >
            <div
              aria-hidden="true"
              className="size-full"
              style={{ background: PROMO_CARD_GRADIENT }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(rgba(0,0,0,0) 35%, rgba(0,0,0,0.72) 100%)",
              }}
            />
            <figcaption className="absolute inset-x-0 bottom-0 p-4">
              <h4 className="text-lg font-bold leading-6 text-white">
                {card.title}
              </h4>
              {card.description && (
                <p className="mt-1.5 text-sm leading-5 text-zinc-300">
                  {card.description}
                </p>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

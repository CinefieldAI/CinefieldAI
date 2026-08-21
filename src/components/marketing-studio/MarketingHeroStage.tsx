"use client";

import { useState } from "react";

interface HeroCardItem {
  id: string;
  label: string;
  chipKey: string;
  videoSrc: string;
  posterSrc: string;
  svgIcon: React.ReactNode;
}

const HERO_CARDS: HeroCardItem[] = [
  {
    id: "ugc",
    label: "UGC",
    chipKey: "ugc",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-UGC.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-UGC.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M5 5.75C5 3.67893 6.67893 2 8.75 2H15.25C17.3211 2 19 3.67893 19 5.75V6H21.25C21.6642 6 22 6.33579 22 6.75C22 7.16421 21.6642 7.5 21.25 7.5H19V16.25C19 18.3211 17.3211 20 15.25 20H12V21.25C12 21.6642 11.6642 22 11.25 22H5.75C5.33579 22 5 21.6642 5 21.25V14.5H4.25C3.83579 14.5 3.5 14.1642 3.5 13.75V10.75C3.5 10.3358 3.83579 10 4.25 10H5V5.75ZM6.5 6H17.5V5.75C17.5 4.50736 16.4926 3.5 15.25 3.5H8.75C7.50736 3.5 6.5 4.50736 6.5 5.75V6ZM9.96875 9.94444C9.96875 9.53023 10.3045 9.19444 10.7188 9.19444H10.7291C11.1433 9.19444 11.4791 9.53023 11.4791 9.94444C11.4791 10.3587 11.1433 10.6944 10.7291 10.6944H10.7188C10.3045 10.6944 9.96875 10.3587 9.96875 9.94444ZM14.0938 9.94444C14.0938 9.53023 14.4295 9.19444 14.8438 9.19444H14.8541C15.2683 9.19444 15.6041 9.53023 15.6041 9.94444C15.6041 10.3587 15.2683 10.6944 14.8541 10.6944H14.8438C14.4295 10.6944 14.0938 10.3587 14.0938 9.94444ZM9.62214 13.3521C9.97994 13.1435 10.4392 13.2643 10.6479 13.6221C10.88 14.0201 11.2995 14.3043 11.9235 14.4597C12.5525 14.6165 13.3291 14.6239 14.1439 14.5075C14.554 14.449 14.9339 14.7339 14.9925 15.1439C15.051 15.554 14.7661 15.9339 14.3561 15.9925C13.4209 16.1261 12.437 16.1335 11.5608 15.9153C10.6796 15.6957 9.8491 15.2299 9.35214 14.3779C9.14345 14.0201 9.26434 13.5608 9.62214 13.3521Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "product-shot",
    label: "Product shot",
    chipKey: "product-shot",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Product.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Product.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          d="M11 12.2883C11.1547 12.3776 11.25 12.5427 11.25 12.7213V21.8166C11.25 22.2015 10.8333 22.4421 10.5 22.2496L3.24806 18.0628C2.7066 17.7502 2.37305 17.1725 2.37305 16.5473V8.17364C2.37305 7.78874 2.78971 7.54818 3.12304 7.74063L11 12.2883Z"
          fill="currentColor"
        />
        <path
          d="M21.627 16.5473C21.627 17.1725 21.2934 17.7502 20.7519 18.0628L13.5 22.2496C13.1667 22.4421 12.75 22.2015 12.75 21.8166V12.7213C12.75 12.5427 12.8453 12.3776 13 12.2883L20.877 7.74063C21.2103 7.54818 21.627 7.78874 21.627 8.17364V16.5473Z"
          fill="currentColor"
        />
        <path
          d="M20.1261 5.5758C20.4594 5.76825 20.4594 6.24935 20.1261 6.4418L12.25 10.9894C12.0953 11.0788 11.9047 11.0788 11.75 10.9895L3.87307 6.44181C3.53973 6.24936 3.53973 5.76823 3.87307 5.57578L11.125 1.38899C11.6664 1.07638 12.3336 1.07639 12.875 1.38903L20.1261 5.5758Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "motion",
    label: "Motion",
    chipKey: "motion",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Motion.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Motion.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M4.75 3C3.7835 3 3 3.7835 3 4.75V19.25C3 20.2165 3.7835 21 4.75 21H19.25C20.2165 21 21 20.2165 21 19.25V4.75C21 3.7835 20.2165 3 19.25 3H4.75ZM16.1967 7C14.857 7.00033 13.8805 7.70314 13.1397 8.60136C12.4279 9.46444 11.8656 10.5906 11.3517 11.6198L11.329 11.6653C10.788 12.7488 10.2952 13.7269 9.70308 14.4448C9.12941 15.1402 8.53806 15.5 7.80312 15.5H7.75C7.33579 15.5 7 15.8358 7 16.25C7 16.6642 7.33579 17 7.75 17H7.80312C9.14285 17 10.1194 16.2974 10.8602 15.3993C11.5721 14.5362 12.1345 13.41 12.6484 12.3807L12.671 12.3355C13.212 11.252 13.7048 10.2738 14.297 9.55575C14.8706 8.86017 15.462 8.50024 16.1969 8.5H16.25C16.6642 8.5 17 8.16421 17 7.75C17 7.33579 16.6642 7 16.25 7H16.1967Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "ads",
    label: "Ads",
    chipKey: "ads",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Ads.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Ads.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          d="M9.75005 12.0001C9.75005 9.00945 10.0815 6.32893 10.6023 4.41922C10.8642 3.45898 11.1627 2.73613 11.4626 2.27092C11.5335 2.16105 11.5984 2.07431 11.6567 2.00584C11.7706 2.002 11.8851 2.00006 12 2.00006C17.5228 2.00006 22 6.47721 22 12.0001C22 12.115 21.9981 12.2295 21.9942 12.3435C21.9258 12.4018 21.839 12.4666 21.7292 12.5375C21.264 12.8374 20.5411 13.1359 19.5809 13.3978C17.6712 13.9186 14.9907 14.2501 12.0001 14.2501C11.2482 14.2501 10.516 14.2291 9.81064 14.1895C9.771 13.4841 9.75005 12.7519 9.75005 12.0001Z"
          fill="currentColor"
        />
        <path
          d="M21.752 14.223C21.2351 14.4582 20.6344 14.6653 19.9756 14.8449C17.9041 15.4099 15.0846 15.7501 12.0001 15.7501C11.2933 15.7501 10.6005 15.7322 9.9274 15.6979C10.0752 17.1822 10.3086 18.5041 10.6023 19.5809C10.8642 20.5411 11.1627 21.264 11.4626 21.7292C11.5335 21.8391 11.5984 21.9258 11.6567 21.9943C11.7706 21.9981 11.8851 22.0001 12 22.0001C16.7588 22.0001 20.7413 18.6759 21.752 14.223Z"
          fill="currentColor"
        />
        <path
          d="M9.77716 21.7521C9.54193 21.2352 9.33486 20.6345 9.15516 19.9756C8.81932 18.7442 8.56293 17.2485 8.4102 15.5899C6.75163 15.4372 5.25593 15.1808 4.02454 14.8449C3.36563 14.6652 2.76491 14.4582 2.24795 14.2229C3.09643 17.961 6.03905 20.9036 9.77716 21.7521Z"
          fill="currentColor"
        />
        <path
          d="M2.00578 12.3434C2.00194 12.2294 2 12.115 2 12.0001C2 7.2412 5.32416 3.25874 9.77715 2.248C9.54193 2.76495 9.33486 3.36565 9.15516 4.02454C8.5902 6.09604 8.25005 8.91552 8.25005 12.0001C8.25005 12.7068 8.26791 13.3996 8.30224 14.0727C6.81789 13.9249 5.49602 13.6915 4.41922 13.3978C3.45898 13.1359 2.73613 12.8374 2.27092 12.5375C2.16102 12.4666 2.07426 12.4017 2.00578 12.3434Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "posters",
    label: "Posters",
    chipKey: "posters",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-poster.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-poster.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          d="M9.75005 12.0001C9.75005 9.00945 10.0815 6.32893 10.6023 4.41922C10.8642 3.45898 11.1627 2.73613 11.4626 2.27092C11.5335 2.16105 11.5984 2.07431 11.6567 2.00584C11.7706 2.002 11.8851 2.00006 12 2.00006C17.5228 2.00006 22 6.47721 22 12.0001C22 12.115 21.9981 12.2295 21.9942 12.3435C21.9258 12.4018 21.839 12.4666 21.7292 12.5375C21.264 12.8374 20.5411 13.1359 19.5809 13.3978C17.6712 13.9186 14.9907 14.2501 12.0001 14.2501C11.2482 14.2501 10.516 14.2291 9.81064 14.1895C9.771 13.4841 9.75005 12.7519 9.75005 12.0001Z"
          fill="currentColor"
        />
        <path
          d="M21.752 14.223C21.2351 14.4582 20.6344 14.6653 19.9756 14.8449C17.9041 15.4099 15.0846 15.7501 12.0001 15.7501C11.2933 15.7501 10.6005 15.7322 9.9274 15.6979C10.0752 17.1822 10.3086 18.5041 10.6023 19.5809C10.8642 20.5411 11.1627 21.264 11.4626 21.7292C11.5335 21.8391 11.5984 21.9258 11.6567 21.9943C11.7706 21.9981 11.8851 22.0001 12 22.0001C16.7588 22.0001 20.7413 18.6759 21.752 14.223Z"
          fill="currentColor"
        />
        <path
          d="M9.77716 21.7521C9.54193 21.2352 9.33486 20.6345 9.15516 19.9756C8.81932 18.7442 8.56293 17.2485 8.4102 15.5899C6.75163 15.4372 5.25593 15.1808 4.02454 14.8449C3.36563 14.6652 2.76491 14.4582 2.24795 14.2229C3.09643 17.961 6.03905 20.9036 9.77716 21.7521Z"
          fill="currentColor"
        />
        <path
          d="M2.00578 12.3434C2.00194 12.2294 2 12.115 2 12.0001C2 7.2412 5.32416 3.25874 9.77715 2.248C9.54193 2.76495 9.33486 3.36565 9.15516 4.02454C8.5902 6.09604 8.25005 8.91552 8.25005 12.0001C8.25005 12.7068 8.26791 13.3996 8.30224 14.0727C6.81789 13.9249 5.49602 13.6915 4.41922 13.3978C3.45898 13.1359 2.73613 12.8374 2.27092 12.5375C2.16102 12.4666 2.07426 12.4017 2.00578 12.3434Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "marketplace",
    label: "Marketplace",
    chipKey: "marketplace",
    videoSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Marketplace.mp4",
    posterSrc: "/marketing-studio/hero-banners/marketing-studio-slider-poster-Marketplace.webp",
    svgIcon: (
      <svg className="size-full" viewBox="0 0 24 24" fill="none">
        <path
          d="M9.75005 12.0001C9.75005 9.00945 10.0815 6.32893 10.6023 4.41922C10.8642 3.45898 11.1627 2.73613 11.4626 2.27092C11.5335 2.16105 11.5984 2.07431 11.6567 2.00584C11.7706 2.002 11.8851 2.00006 12 2.00006C17.5228 2.00006 22 6.47721 22 12.0001C22 12.115 21.9981 12.2295 21.9942 12.3435C21.9258 12.4018 21.839 12.4666 21.7292 12.5375C21.264 12.8374 20.5411 13.1359 19.5809 13.3978C17.6712 13.9186 14.9907 14.2501 12.0001 14.2501C11.2482 14.2501 10.516 14.2291 9.81064 14.1895C9.771 13.4841 9.75005 12.7519 9.75005 12.0001Z"
          fill="currentColor"
        />
        <path
          d="M21.752 14.223C21.2351 14.4582 20.6344 14.6653 19.9756 14.8449C17.9041 15.4099 15.0846 15.7501 12.0001 15.7501C11.2933 15.7501 10.6005 15.7322 9.9274 15.6979C10.0752 17.1822 10.3086 18.5041 10.6023 19.5809C10.8642 20.5411 11.1627 21.264 11.4626 21.7292C11.5335 21.8391 11.5984 21.9258 11.6567 21.9943C11.7706 21.9981 11.8851 22.0001 12 22.0001C16.7588 22.0001 20.7413 18.6759 21.752 14.223Z"
          fill="currentColor"
        />
        <path
          d="M9.77716 21.7521C9.54193 21.2352 9.33486 20.6345 9.15516 19.9756C8.81932 18.7442 8.56293 17.2485 8.4102 15.5899C6.75163 15.4372 5.25593 15.1808 4.02454 14.8449C3.36563 14.6652 2.76491 14.4582 2.24795 14.2229C3.09643 17.961 6.03905 20.9036 9.77716 21.7521Z"
          fill="currentColor"
        />
        <path
          d="M2.00578 12.3434C2.00194 12.2294 2 12.115 2 12.0001C2 7.2412 5.32416 3.25874 9.77715 2.248C9.54193 2.76495 9.33486 3.36565 9.15516 4.02454C8.5902 6.09604 8.25005 8.91552 8.25005 12.0001C8.25005 12.7068 8.26791 13.3996 8.30224 14.0727C6.81789 13.9249 5.49602 13.6915 4.41922 13.3978C3.45898 13.1359 2.73613 12.8374 2.27092 12.5375C2.16102 12.4666 2.07426 12.4017 2.00578 12.3434Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

export default function MarketingHeroStage() {
  const [activeIndex, setActiveIndex] = useState(3); // Default centered card: Ads (index 3)

  // Positions and dimensions based on distance from activeIndex
  const getCardStyle = (index: number) => {
    const diff = index - activeIndex;

    // Center card (active)
    if (diff === 0) {
      return {
        width: 292,
        height: 228,
        transform: "translate3d(442px, 20px, 48px) scale(1)",
        opacity: 1,
        zIndex: 30,
        pointerEvents: "auto" as const,
      };
    }

    // Immediately to the left of center
    if (diff === -1) {
      return {
        width: 194,
        height: 180,
        transform: "translate3d(260px, 44px, 24px) scale(1)",
        opacity: 1,
        zIndex: 20,
        pointerEvents: "auto" as const,
      };
    }

    // Two steps to the left
    if (diff === -2) {
      return {
        width: 168,
        height: 150,
        transform: "translate3d(110px, 59px, 0px) scale(1)",
        opacity: 0.9,
        zIndex: 10,
        pointerEvents: "auto" as const,
      };
    }

    // Three steps to the left
    if (diff <= -3) {
      return {
        width: 148,
        height: 130,
        transform: "translate3d(-20px, 69px, -24px) scale(1)",
        opacity: 0,
        zIndex: 5,
        pointerEvents: "none" as const,
      };
    }

    // Immediately to the right of center
    if (diff === 1) {
      return {
        width: 194,
        height: 180,
        transform: "translate3d(720px, 44px, 24px) scale(1)",
        opacity: 1,
        zIndex: 20,
        pointerEvents: "auto" as const,
      };
    }

    // Two steps to the right
    if (diff === 2) {
      return {
        width: 168,
        height: 150,
        transform: "translate3d(896px, 59px, 0px) scale(1)",
        opacity: 0.9,
        zIndex: 10,
        pointerEvents: "auto" as const,
      };
    }

    // Three steps to the right
    if (diff >= 3) {
      return {
        width: 148,
        height: 130,
        transform: "translate3d(1024px, 69px, -24px) scale(1)",
        opacity: 0,
        zIndex: 5,
        pointerEvents: "none" as const,
      };
    }

    return {};
  };

  return (
    <div className="relative z-10 flex flex-col items-center justify-center w-full max-w-[1232px] mx-auto pt-2 pb-2">
      {/* TOP PILL BADGE */}
      <span
        data-ms2-marketing-studio-badge="true"
        className="relative z-10 isolate mb-3 flex h-7 items-center justify-center gap-1 overflow-hidden rounded-full border border-white/10 px-3.5"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(169deg, rgba(34,34,33,0.6) 4%, rgba(59,60,58,0.6) 93%)",
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-white/10 mix-blend-overlay"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-white/30 mix-blend-hard-light"
        />
        <span
          className="relative whitespace-nowrap bg-clip-text text-xs font-bold uppercase tracking-wide text-transparent"
          style={{
            backgroundImage: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 90%)",
          }}
        >
          MARKETING STUDIO
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.24)]"
        />
      </span>

      {/* 3D HERO CAROUSEL STAGE AREA */}
      <div
        data-ms2-hero-stage="true"
        className="relative shrink-0 touch-pan-y select-none mx-auto"
        style={{
          width: "1176px",
          height: "264px",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Glow Blur Effect behind active card */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
          {HERO_CARDS.map((card, idx) => (
            <div
              key={`glow-${card.id}`}
              className="absolute overflow-hidden rounded-3xl blur-[60px] transition-opacity duration-500 ease-out"
              style={{
                top: "20px",
                left: "442px",
                width: "292px",
                height: "228px",
                opacity: idx === activeIndex ? 0.6 : 0,
                visibility: idx === activeIndex ? "visible" : "hidden",
              }}
            >
              <img
                alt=""
                draggable="false"
                className="absolute inset-0 size-full object-cover"
                src={card.posterSrc}
              />
            </div>
          ))}
        </div>

        {/* 6 Interactive Video Cards */}
        {HERO_CARDS.map((card, index) => {
          const isActive = index === activeIndex;
          const style = getCardStyle(index);

          return (
            <button
              key={card.id}
              data-index={index}
              type="button"
              aria-pressed={isActive}
              aria-label={card.label}
              onClick={() => setActiveIndex(index)}
              className="absolute left-0 top-0 overflow-hidden rounded-2xl border border-white/15 bg-black/60 shadow-2xl transition-all duration-500 cubic-bezier(0.25, 1, 0.5, 1) hover:border-white/40 cursor-pointer"
              style={{
                width: `${style.width}px`,
                height: `${style.height}px`,
                transform: style.transform,
                opacity: style.opacity,
                zIndex: style.zIndex,
                pointerEvents: style.pointerEvents,
              }}
            >
              {/* Card Video / Poster */}
              <video
                aria-hidden="true"
                src={card.videoSrc}
                poster={card.posterSrc}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 size-full object-cover"
              />

              {/* Bottom Chip Badge */}
              <span
                data-ms2-hero-chip={card.chipKey}
                className="ms2-hero-chip absolute bottom-2.5 left-2.5 flex items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 drop-shadow-md backdrop-blur-md transition-all"
                style={{
                  height: isActive ? "26px" : "22px",
                }}
              >
                <span
                  data-ms2-hero-chip-icon="true"
                  className="shrink-0 text-white"
                  style={{
                    width: isActive ? "12px" : "10px",
                    height: isActive ? "12px" : "10px",
                  }}
                >
                  {card.svgIcon}
                </span>
                <span
                  className="whitespace-nowrap font-bold uppercase text-white tracking-wider"
                  style={{
                    fontSize: isActive ? "11px" : "9px",
                    lineHeight: "1",
                  }}
                >
                  {card.label}
                </span>
              </span>

              {/* Stroke & Inner Shadow */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 border-2 transition-colors ${
                  isActive ? "border-white/30" : "border-white/10"
                }`}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 shadow-[inset_0px_2px_4px_0px_rgba(255,255,255,0.08)]"
              />
            </button>
          );
        })}
      </div>

      {/* HEADLINE TEXT UNDER CARDS */}
      <div className="mt-3 flex flex-col items-center justify-center text-center">
        <h1
          className="text-center uppercase whitespace-nowrap"
          style={{
            fontFamily: "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif",
            fontWeight: 900,
            fontSize: "clamp(22px, 2.6vw, 34px)",
            lineHeight: 1.15,
            letterSpacing: "0.03em",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #F0F0F0 30%, #ADADAD 60%, #7A7A7A 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          TURN ANY PRODUCT<br />INTO READY TO POST CONTENT
        </h1>
      </div>
    </div>
  );
}

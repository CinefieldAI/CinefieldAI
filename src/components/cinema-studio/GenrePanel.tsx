"use client";

import { useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { genrePresets, DEFAULT_GENRE } from "./genrePresetsData";

interface GenrePanelProps {
  open: boolean;
  onClose: () => void;
  selected?: string;
  onSelect?: (genre: string) => void;
  docked?: boolean;
}

// Arc positioning constants
const ARC_CONFIG = {
  centerY: 172,
  centerX: 58,
  radiusX: 42,
  stepY: 64,
  saturateAt: 4,
};

const calculateArcPosition = (
  distFromSelected: number,
  isAbove: boolean
): { x: number; y: number; opacity: number } => {
  const offset = isAbove ? -distFromSelected : distFromSelected;
  const y = ARC_CONFIG.centerY + offset * ARC_CONFIG.stepY;

  const normalized = Math.min(distFromSelected / ARC_CONFIG.saturateAt, 1);
  const angleRad = (normalized * 90 * Math.PI) / 180;
  const x = ARC_CONFIG.centerX - Math.sin(angleRad) * ARC_CONFIG.radiusX;

  let opacity = 1;
  if (distFromSelected === 0) opacity = 1;
  else if (distFromSelected === 1) opacity = 0.716667;
  else if (distFromSelected === 2) opacity = 0.433333;
  else opacity = 0.15;

  return { x, y, opacity };
};

export default function GenrePanel({
  open,
  onClose,
  selected = DEFAULT_GENRE,
  onSelect,
  docked = false,
}: GenrePanelProps) {
  const selectedIndex = genrePresets.findIndex((g) => g.label === selected);
  const selectedGenre = genrePresets[selectedIndex] || genrePresets[0];

  const handlePrev = () => {
    const newIndex =
      (selectedIndex - 1 + genrePresets.length) % genrePresets.length;
    const newGenre = genrePresets[newIndex].label;
    onSelect?.(newGenre);
  };

  const handleNext = () => {
    const newIndex = (selectedIndex + 1) % genrePresets.length;
    const newGenre = genrePresets[newIndex].label;
    onSelect?.(newGenre);
  };

  if (!open) return null;

  const panelContent = (
    <div className="flex h-[27rem] w-full flex-col gap-3 overflow-hidden rounded-[20px] p-1 backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(217,217,217,0.04)] bg-gradient-to-b from-[rgba(21,21,21,0.88)] to-[rgba(21,21,21,0.88)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="flex-1 text-sm font-semibold text-white">
          Genre
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full bg-surface-primary border border-separator-card/4 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="size-3 text-icon-secondary" />
        </button>
      </div>

      {/* Content */}
      <div className="relative overflow-hidden rounded-2xl bg-white/5 min-h-0 flex-1">
        {/* Radial background glow */}
        <div
          className="absolute pointer-events-none rounded-full"
          style={{
            width: 600,
            height: 600,
            left: -100,
            top: -150,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 60%, transparent 100%)",
          }}
        />

        {/* Large circular preview */}
        <div
          className="absolute rounded-full overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
          style={{
            width: 260,
            height: 260,
            left: 128,
            top: 62,
          }}
        >
          <video
            key={selectedGenre.src}
            src={selectedGenre.src}
            muted
            loop
            autoPlay
            playsInline
            disablePictureInPicture
            preload="metadata"
            className="object-cover size-full absolute inset-0"
          />
          <div className="absolute inset-0 rounded-full shadow-[inset_0_-2px_8px_0_rgba(0,0,0,0.12)] z-[2]" />
        </div>

        {/* Genre arc selector on right */}
        <div
          className="genre-radial-menu absolute top-0 bottom-0 select-none"
          style={{
            left: 556,
            width: 220,
          }}
        >
          {genrePresets.map((genre, idx) => {
            const distFromSelected = Math.abs(idx - selectedIndex);
            const isAbove = idx < selectedIndex;
            const { x: arcX, y: arcY, opacity } =
              calculateArcPosition(distFromSelected, isAbove);
            const textColor =
              distFromSelected === 0
                ? "text-white"
                : "text-font-secondary";
            const isClickable = distFromSelected === 0;

            return (
              <div
                key={idx}
                className={`genre-radial-option absolute flex items-center gap-3 px-2 py-2 transition-all duration-300 will-change-transform ${
                  isClickable
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                }`}
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate(${arcX}px, ${arcY}px)`,
                  opacity,
                  zIndex: 100 - distFromSelected,
                }}
              >
                <button
                  onClick={() => onSelect?.(genre.label)}
                  className="flex items-center gap-3 bg-transparent border-none p-0 cursor-pointer"
                >
                  <div
                    className="relative w-10 h-10 rounded-full overflow-hidden shrink-0 aspect-square"
                    style={{
                      minWidth: "2.5rem",
                      minHeight: "2.5rem",
                      flexShrink: 0,
                    }}
                  >
                    <video
                      src={genre.src}
                      muted
                      loop
                      autoPlay
                      playsInline
                      disablePictureInPicture
                      preload="metadata"
                      className="object-cover size-full"
                    />
                    <div
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(101deg, rgba(255,255,255,0.12) 0.85%, transparent 8%, rgba(10,14,15,0.06) 12.4%, rgba(7,10,13,0.06) 93.8%, rgba(215,215,215,0.12) 98.5%)",
                      }}
                    />
                  </div>
                  <span
                    className={`text-sm font-medium whitespace-nowrap ${textColor}`}
                  >
                    {genre.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Up/Down buttons */}
        <div
          className="genre-arrow-control absolute top-1/2 -translate-y-1/2 flex flex-col gap-4 z-[200]"
          style={{ right: 20 }}
        >
          <button
            onClick={handlePrev}
            className="flex size-10 items-center justify-center rounded-full cursor-pointer border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.35)] mix-blend-luminosity hover:bg-white/8 transition-colors"
          >
            <ChevronUp className="size-5 text-white rotate-180" />
          </button>
          <button
            onClick={handleNext}
            className="flex size-10 items-center justify-center rounded-full cursor-pointer border border-[rgba(197,197,197,0.3)] backdrop-blur-[4px] bg-white/4 shadow-[inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.35)] mix-blend-luminosity hover:bg-white/8 transition-colors"
          >
            <ChevronDown className="size-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );

  // Docked mode: return content directly
  if (docked) {
    return panelContent;
  }

  // Modal mode: wrap in backdrop
  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-[40px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[min(876px,calc(100vw-32px))]">
        {panelContent}
      </div>
    </div>
  );
}

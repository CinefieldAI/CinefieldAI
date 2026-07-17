"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface MotionPresetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset: (preset: string) => void;
}

/**
 * "GENERAL" tile's presets panel (Minimax Hailuo family). Categories are
 * confirmed verbatim from a live click-audit ("Generation settings All Horror
 * Viral Camera Control Effects UGC Action Movement Emotions Commercial ...").
 * The preset grid itself only lists "General" — the remaining ~30 preset
 * names captured in that audit are run together as concatenated DOM text
 * with no reliable word boundaries (e.g. "...MONEY RAIN WIREFRAME TRAIN
 * RUSH..."), so they are deliberately NOT guessed at here rather than risking
 * fabricated preset names. No local preset thumbnail/video assets exist yet,
 * so each card is a solid-background label card (no remote URLs).
 */
const CATEGORIES = [
  "All",
  "Horror",
  "Viral",
  "Camera Control",
  "Effects",
  "UGC",
  "Action",
  "Movement",
  "Emotions",
  "Commercial",
];

export default function MotionPresetsPanel({
  isOpen,
  onClose,
  onSelectPreset,
}: MotionPresetsPanelProps) {
  const [activeCategory, setActiveCategory] = useState("All");

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="motion-presets-title"
        className="relative w-[min(960px,calc(100vw-32px))] max-h-[min(40rem,calc(100vh-32px))] overflow-hidden rounded-2xl border border-white/10 bg-[rgba(24,26,30,0.98)] p-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        <h2 id="motion-presets-title" className="px-3 pt-3 text-sm font-semibold text-white">
          Generation settings
        </h2>

        <nav className="hide-scrollbar mt-3 flex items-center gap-1 overflow-x-auto px-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`h-8 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors ${
                activeCategory === cat
                  ? "border-white/10 bg-white/10 text-white"
                  : "border-transparent text-neutral-400 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>

        <div className="mt-3 grid grid-cols-4 gap-3 overflow-y-auto p-3 sm:grid-cols-5 md:grid-cols-6">
          <button
            type="button"
            onClick={() => {
              onSelectPreset("General");
              onClose();
            }}
            className="flex aspect-square flex-col items-start justify-end rounded-xl bg-[#2E3132] p-2 text-left transition-colors hover:bg-[#383b3c]"
          >
            <p className="text-[11px] font-bold uppercase leading-tight text-white">General</p>
          </button>
        </div>
      </div>
    </div>
  );
}

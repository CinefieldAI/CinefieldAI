"use client";

import { ArrowLeft, Heart } from "lucide-react";

export type AudioTab = "all" | "liked";
export type AudioLayout = "list" | "grid";

interface AudioTopControlsProps {
  activeTab: AudioTab;
  onTabChange: (tab: AudioTab) => void;
  layout: AudioLayout;
  onLayoutChange: (layout: AudioLayout) => void;
  density: number;
  onDensityChange: (value: number) => void;
  onBack: () => void;
}

export default function AudioTopControls({
  activeTab,
  onTabChange,
  onBack,
}: AudioTopControlsProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-4">
      {/* Left: back + tabs */}
      <div className="pointer-events-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex gap-1 rounded-xl border border-white/10 bg-zinc-900/70 p-0.5 backdrop-blur">
          <button
            type="button"
            onClick={() => onTabChange("all")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "all"
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onTabChange("liked")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "liked"
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Heart
              className="h-3.5 w-3.5"
              fill={activeTab === "liked" ? "currentColor" : "none"}
            />
            Liked
          </button>
        </div>
      </div>
    </div>
  );
}

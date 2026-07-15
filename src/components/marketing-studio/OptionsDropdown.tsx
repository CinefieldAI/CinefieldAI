"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, Monitor, Heart, Clock } from "lucide-react";

interface OptionsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  quality: string;
  onQualityChange: (quality: string) => void;
  duration: number;
  onDurationChange: (duration: number) => void;
  triggerButtonRef?: React.RefObject<HTMLButtonElement | null>;
  promptBarDock?: "top" | "bottom";
}

const ASPECT_RATIOS = ["Auto", "21:9", "16:9", "9:16", "1:1", "4:5"];
const QUALITY_OPTIONS = ["720p", "1080p"];

export default function OptionsDropdown({
  isOpen,
  onClose,
  aspectRatio,
  onAspectRatioChange,
  quality,
  onQualityChange,
  duration,
  onDurationChange,
  triggerButtonRef,
  promptBarDock = "bottom",
}: OptionsDropdownProps) {
  const [activeNestedOption, setActiveNestedOption] = useState<
    "aspectRatio" | "quality" | null
  >(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && triggerButtonRef?.current) {
      const rect = triggerButtonRef.current.getBoundingClientRect();
      setPosition({
        top: promptBarDock === "bottom"
          ? window.innerHeight - 160 - 280
          : 160,
        left: rect.left,
      });
    }
  }, [isOpen, promptBarDock, triggerButtonRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        triggerButtonRef?.current &&
        !triggerButtonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, triggerButtonRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="fixed z-[1200] rounded-2xl bg-black/60 border border-white/10 backdrop-blur-3xl p-2 flex flex-col gap-1 w-[280px] shadow-lg"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ASPECT RATIO ROW */}
      <div className="relative">
        <button
          onClick={() => {
            setActiveNestedOption(
              activeNestedOption === "aspectRatio" ? null : "aspectRatio"
            );
          }}
          className="w-full h-10 rounded-lg bg-white/5 hover:bg-white/[0.07] px-2.5 py-2 text-left flex justify-between items-center transition-colors"
        >
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-white/60" />
            <span className="text-xs text-white/60 font-medium">
              Aspect ratio
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-white font-medium">
              {aspectRatio}
            </span>
            <ChevronRight className="h-3 w-3 text-white/60" />
          </div>
        </button>

        {/* ASPECT RATIO NESTED SELECTOR */}
        {activeNestedOption === "aspectRatio" && (
          <div className="absolute left-0 top-full mt-1 w-[280px] bg-black/60 border border-white/10 backdrop-blur-3xl rounded-lg p-2 z-[1201]">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                onClick={() => {
                  onAspectRatioChange(ratio);
                  setActiveNestedOption(null);
                }}
                className={`w-full h-9 rounded-lg px-2.5 py-2 text-sm font-medium text-left transition-colors ${
                  aspectRatio === ratio
                    ? "bg-white/20 text-white"
                    : "bg-white/5 hover:bg-white/[0.07] text-white/70"
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* QUALITY ROW */}
      <div className="relative">
        <button
          onClick={() => {
            setActiveNestedOption(
              activeNestedOption === "quality" ? null : "quality"
            );
          }}
          className="w-full h-10 rounded-lg bg-white/5 hover:bg-white/[0.07] px-2.5 py-2 text-left flex justify-between items-center transition-colors"
        >
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-white/60" />
            <span className="text-xs text-white/60 font-medium">Quality</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-white font-medium">{quality}</span>
            <ChevronRight className="h-3 w-3 text-white/60" />
          </div>
        </button>

        {/* QUALITY NESTED SELECTOR */}
        {activeNestedOption === "quality" && (
          <div className="absolute left-0 top-full mt-1 w-[280px] bg-black/60 border border-white/10 backdrop-blur-3xl rounded-lg p-2 z-[1201]">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  onQualityChange(q);
                  setActiveNestedOption(null);
                }}
                className={`w-full h-9 rounded-lg px-2.5 py-2 text-sm font-medium text-left transition-colors ${
                  quality === q
                    ? "bg-white/20 text-white"
                    : "bg-white/5 hover:bg-white/[0.07] text-white/70"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* DURATION SLIDER ROW */}
      <div className="h-10 rounded-lg bg-white/5 px-2.5 py-2 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-white/60" />
          <span className="text-xs text-white/60 font-medium">Duration</span>
        </div>
        <input
          type="range"
          min="4"
          max="15"
          value={duration}
          onChange={(e) => onDurationChange(parseInt(e.target.value))}
          className="w-20 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-400"
          style={{
            backgroundImage: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${
              ((duration - 4) / (15 - 4)) * 100
            }%, rgba(255,255,255,0.1) ${((duration - 4) / (15 - 4)) * 100}%, rgba(255,255,255,0.1) 100%)`,
          }}
        />
        <span className="text-sm text-white font-medium w-10 text-right">
          {duration}s
        </span>
      </div>
    </div>
  );
}

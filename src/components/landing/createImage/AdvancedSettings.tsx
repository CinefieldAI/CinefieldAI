"use client";

import { Dices, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  IMAGE_SIZES,
  OUTPUT_COUNTS,
  QUALITY_PRESETS,
} from "./createImageData";

export interface AdvancedSettingsState {
  quality: (typeof QUALITY_PRESETS)[number];
  seed: string;
  negativePrompt: string;
  outputCount: number;
  imageSize: (typeof IMAGE_SIZES)[number];
}

interface AdvancedSettingsProps {
  value: AdvancedSettingsState;
  onChange: (next: Partial<AdvancedSettingsState>) => void;
}

export default function AdvancedSettings({ value, onChange }: AdvancedSettingsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] data-[state=open]:border-magenta-500/40 data-[state=open]:text-magenta-400"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Settings</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={10} className="w-80">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Advanced Settings
        </p>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Quality</p>
            <div className="flex gap-1.5">
              {QUALITY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChange({ quality: preset })}
                  className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    value.quality === preset
                      ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                      : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-400">Seed</p>
              <div className="flex items-center gap-1.5">
                <input
                  value={value.seed}
                  onChange={(e) => onChange({ seed: e.target.value })}
                  placeholder="Random"
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-magenta-500/40 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Randomize seed"
                  onClick={() => onChange({ seed: String(Math.floor(Math.random() * 1_000_000)) })}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-zinc-400 transition-colors hover:bg-magenta-500/10 hover:text-magenta-400"
                >
                  <Dices className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-400">Output</p>
              <div className="flex gap-1">
                {OUTPUT_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => onChange({ outputCount: count })}
                    className={`flex h-8 flex-1 items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
                      value.outputCount === count
                        ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                        : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400">Image Size</p>
              <span className="font-mono text-xs text-magenta-400">{value.imageSize}px</span>
            </div>
            <div className="flex gap-1">
              {IMAGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onChange({ imageSize: size })}
                  className={`flex-1 rounded-lg px-1 py-1.5 text-xs font-medium transition-colors ${
                    value.imageSize === size
                      ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                      : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Negative Prompt</p>
            <textarea
              rows={2}
              value={value.negativePrompt}
              onChange={(e) => onChange({ negativePrompt: e.target.value })}
              placeholder="blurry, low quality, distorted hands..."
              className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-magenta-500/40 focus:outline-none"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

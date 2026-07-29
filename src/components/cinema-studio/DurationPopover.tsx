"use client";

import { useState } from "react";
import { Clock, ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

interface DurationPopoverProps {
  value: number;
  durations: number[];
  onChange: (value: number) => void;
  portalContainer?: HTMLElement | null;
  /** Controlled open state — omit to keep the existing uncontrolled behavior. */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Forces button-list vs. slider rendering, overriding the default
   * length-based heuristic (needed when a 2-value array is a pair of
   * discrete options rather than a min/max range, e.g. Higgsfield's 3s/5s).
   */
  mode?: "buttons" | "slider";
  /** Popover alignment relative to the trigger — defaults to "start" to
   *  preserve every existing caller's behavior; Cinema Studio 3.5 uses
   *  "center" so the popup sits centered above its trigger. */
  align?: "start" | "center" | "end";
  /** Overrides the computed width (220px buttons / 334px slider) — Cinema
   *  Studio 3.5 uses a stable 200px regardless of mode. */
  width?: number;
  /** Radix collision padding — defaults to 0 (existing behavior). */
  collisionPadding?: number;
}

/** Shared h-7 control-pill style. */
const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

export default function DurationPopover({
  value,
  durations,
  onChange,
  portalContainer,
  isOpen,
  onOpenChange,
  mode,
  align = "start",
  width,
  collisionPadding = 0,
}: DurationPopoverProps) {
  const [open, setOpen] = useState(false);
  const controlledOpen = isOpen !== undefined ? isOpen : open;
  const handleOpenChange = (newOpen: boolean) => {
    if (isOpen === undefined) setOpen(newOpen);
    onOpenChange?.(newOpen);
  };
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const showButtons = mode ? mode === "buttons" : durations.length > 2;

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Duration"
          aria-haspopup="dialog"
          aria-expanded={controlledOpen}
          className={PILL}
        >
          <Clock className="size-3.5 text-neutral-400" />
          {value}s
          <ChevronDown className="size-3 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align={align}
          sideOffset={8}
          collisionPadding={collisionPadding}
          className="z-[100000] rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] p-2 shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur-[40px] pointer-events-auto"
          style={{ width: width ?? (showButtons ? "220px" : "334px") }}
        >
          <div className="flex flex-col gap-3 rounded-xl p-2">
            <div>
              <label className="text-xs font-medium text-neutral-400 truncate">
                Duration
              </label>
            </div>
            {showButtons ? (
              <div className="space-y-1">
                {durations.map((d) => {
                  const selected = d === value;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        onChange(d);
                        handleOpenChange(false);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        selected
                          ? "bg-[#131517] text-[#00e5ff]"
                          : "text-white hover:bg-[#131517]"
                      }`}
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="relative h-9 overflow-hidden rounded-md border border-[#424242] bg-[rgba(255,255,255,0.05)] hover:border-white/24">
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={value}
                  onChange={(e) => onChange(Number(e.target.value))}
                  className="absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-[#00e5ff] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:bg-[#00e5ff] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
                  style={{
                    background: `linear-gradient(to right, #00e5ff 0%, #00e5ff ${
                      ((value - min) / (max - min)) * 100
                    }%, rgba(255,255,255,0.05) ${
                      ((value - min) / (max - min)) * 100
                    }%, rgba(255,255,255,0.05) 100%)`,
                  }}
                />
                <div
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs font-medium text-white pointer-events-none"
                  style={{ zIndex: 10 }}
                >
                  {value}s
                </div>
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

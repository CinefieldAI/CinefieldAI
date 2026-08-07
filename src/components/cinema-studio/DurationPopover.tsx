"use client";

import { useState } from "react";
import { Clock, ChevronDown, Check } from "lucide-react";
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

/** Shared h-8 control-pill style with solid black background and thin orange border. */
const PILL =
  "flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[rgba(4,4,5,0.98)] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[rgba(16,16,17,0.98)] focus:outline-none focus:ring-2 focus:ring-[#D97757]";

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

  const defaultDuration = durations[0] ?? 5;
  const isModified = value !== defaultDuration;

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Duration"
          aria-haspopup="dialog"
          aria-expanded={controlledOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            controlledOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
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
          className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#141618]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          style={{ width: width ?? (showButtons ? "220px" : "334px") }}
        >
          <div className="flex flex-col gap-2 rounded-xl p-1">
            <div className="px-2 py-1">
              <span className="text-[11px] font-bold tracking-wider text-white/40">
                Duration
              </span>
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
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-all duration-150 ${
                        selected
                          ? "bg-white/10 text-white font-semibold"
                          : "text-white/80 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span>{d}s</span>
                      {selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
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
                  className="absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-[#D97757] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:bg-[#D97757] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
                  style={{
                    background: `linear-gradient(to right, #D97757 0%, #D97757 ${
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

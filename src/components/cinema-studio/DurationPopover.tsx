"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

interface DurationPopoverProps {
  value: number;
  durations: number[];
  onChange: (value: number) => void;
  portalContainer?: HTMLElement | null;
}

/** Shared h-7 control-pill style. */
const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

export default function DurationPopover({
  value,
  durations,
  onChange,
  portalContainer,
}: DurationPopoverProps) {
  const [open, setOpen] = useState(false);
  const min = Math.min(...durations);
  const max = Math.max(...durations);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Duration"
          aria-expanded={open}
          className={PILL}
        >
          <Clock className="size-3.5 text-neutral-400" />
          {value}s
          <ChevronDown className="size-3 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer || document.body}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] w-[334px] rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] p-2 shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur-[40px] pointer-events-auto"
        >
          <div className="flex flex-col gap-3 rounded-xl p-2">
            <div>
              <label className="text-xs font-medium text-neutral-400 truncate">
                Duration
              </label>
            </div>
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
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

interface QualityPopoverProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}

export default function QualityPopover({
  value,
  onChange,
  options,
}: QualityPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="h-10 px-3 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-1"
        >
          {value}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className="z-[100000] w-48 rounded-xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-2 shadow-xl"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase text-zinc-400 mb-1">
            Select quality
          </div>
          <div className="flex flex-col gap-1">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  value === option
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50"
                    : "text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

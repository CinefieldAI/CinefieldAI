"use client";

import { ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";

interface ResolutionButtonProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}

export default function ResolutionButton({
  value,
  onChange,
  options,
}: ResolutionButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="h-9 px-3 rounded-lg border border-white/10 bg-white/5 text-white text-xs font-medium hover:bg-white/10 transition-colors flex items-center gap-2"
        >
          <span>{value}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          className="z-[100000] w-36 rounded-lg border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] overflow-hidden"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-xs font-medium text-left hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0 ${
                value === option ? "bg-white/10 text-[#E61E8F]" : "text-white"
              }`}
            >
              {option}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

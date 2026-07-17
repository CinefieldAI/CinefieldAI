"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";

interface BitrateControlProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

const BITRATE_OPTIONS = [
  { value: "High", description: "Less compression · larger size" },
  { value: "Standard", description: "More compression · smaller size" },
];

/** Verbatim reference icon — a small sparkle/quality-burst shape (Seedance 2.0's Bitrate chip). */
function BitrateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="size-4 text-neutral-400">
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        d="M13.986 7.75h.028a.25.25 0 0 1 .233.16l1.344 3.494a1.75 1.75 0 0 0 1.005 1.005l3.494 1.344a.25.25 0 0 1 .16.233v.028a.25.25 0 0 1-.16.233l-3.494 1.344a1.75 1.75 0 0 0-.93.836l-.075.169-1.344 3.494a.25.25 0 0 1-.233.16h-.028a.25.25 0 0 1-.233-.16l-1.344-3.494a1.75 1.75 0 0 0-.836-.93l-.169-.075-3.494-1.344a.25.25 0 0 1-.16-.233v-.028a.25.25 0 0 1 .16-.233l3.494-1.344a1.75 1.75 0 0 0 1.005-1.005l1.344-3.494a.25.25 0 0 1 .233-.16ZM7.541 5.454A1.75 1.75 0 0 0 8.546 6.46L9.95 7l-1.405.541A1.75 1.75 0 0 0 7.54 8.546L7 9.95l-.541-1.405A1.75 1.75 0 0 0 5.454 7.54L4.048 7l1.406-.541A1.75 1.75 0 0 0 6.46 5.454L7 4.048z"
      />
    </svg>
  );
}

/** Seedance 2.0 family's Bitrate chip — High (default) / Standard. */
export default function BitrateControl({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: BitrateControlProps) {
  const [open, setOpen] = useState(false);
  const controlledOpen = isOpen !== undefined ? isOpen : open;

  const handleOpenChange = (newOpen: boolean) => {
    if (isOpen === undefined) setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Bitrate"
          aria-haspopup="listbox"
          aria-expanded={controlledOpen}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <BitrateIcon />
          {value}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] w-60 overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 pointer-events-auto"
        >
          <div className="px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Bitrate
            </span>
          </div>
          {BITRATE_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  handleOpenChange(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selected ? "bg-[#131517]" : "hover:bg-[#131517]"
                }`}
              >
                <BitrateIcon />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{opt.value}</span>
                  <span className="block truncate text-xs text-gray-400">{opt.description}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-[#00e5ff]" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, MonitorPlay } from "lucide-react";

const DEFAULT_RESOLUTION_OPTIONS = ["480p", "720p", "1080p", "4K"];

interface ResolutionPopoverProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
  /** Overrides the default option list (e.g. Kling 3.0 only supports 720p/1080p/4K). */
  options?: string[];
  /** Overrides the default 180px popup width — Cinema Studio 3.5 uses a
   *  compact 120px. */
  width?: number;
  /** Radix collision padding — defaults to 0 (existing behavior). */
  collisionPadding?: number;
}

export default function ResolutionPopover({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
  options = DEFAULT_RESOLUTION_OPTIONS,
  width = 180,
  collisionPadding = 0,
}: ResolutionPopoverProps) {
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
          aria-label="Resolution"
          aria-haspopup="listbox"
          aria-expanded={controlledOpen}
          className="flex h-8 items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[rgba(255,255,255,0.08)] focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <MonitorPlay className="size-4" />
          <span className="min-w-[40px] text-center">{value}</span>
          <ChevronDown className="size-3 text-neutral-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={collisionPadding}
          role="listbox"
          aria-label="Resolution"
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 pointer-events-auto"
          style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
        >
          <div className="px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Resolution
            </span>
          </div>
          {options.map((opt) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt);
                  handleOpenChange(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selected
                    ? "bg-[#131517]"
                    : "hover:bg-[#131517]"
                }`}
              >
                <span className="text-sm font-medium text-white">
                  {opt}
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

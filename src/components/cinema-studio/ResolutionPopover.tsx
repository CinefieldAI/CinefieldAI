"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useListboxNav } from "@/hooks/useListboxNav";
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

  const defaultRes = options[0] ?? "720p";
  const isModified = value !== defaultRes;

  const nav = useListboxNav({
    count: options.length,
    selectedIndex: options.indexOf(value),
    open: controlledOpen,
    onSelect: (index) => {
      const opt = options[index];
      if (opt === undefined) return;
      onChange(opt);
      handleOpenChange(false);
    },
  });

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Resolution"
          aria-haspopup="listbox"
          aria-expanded={controlledOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            controlledOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
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
          onKeyDown={nav.handleKeyDown}
          onOpenAutoFocus={nav.handleOpenAutoFocus}
          className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#141618]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
        >
          <div className="px-3 py-1.5">
            <span className="text-[11px] font-bold tracking-wider text-white/40">
              Resolution
            </span>
          </div>
          {options.map((opt, index) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                {...nav.getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt);
                  handleOpenChange(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left outline-none transition-all duration-150 ${
                  selected
                    ? "bg-white/10 text-white font-semibold"
                    : nav.activeIndex === index
                      ? "bg-white/5 text-white"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="text-sm font-medium text-white">
                  {opt}
                </span>
                {selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

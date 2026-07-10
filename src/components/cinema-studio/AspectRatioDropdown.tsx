"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, RectangleHorizontal } from "lucide-react";
import { ASPECT_RATIO_OPTIONS } from "./cinemaStudioData";

interface AspectRatioDropdownProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

/** Small rectangle preview shaped to the option's aspect ratio. */
function ShapeIcon({ shape }: { shape: [number, number] }) {
  const [w, h] = shape;
  const scale = 22 / Math.max(w, h);
  return (
    <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-sm border border-white/20 bg-white/10">
      <span
        className="rounded-[1px] border border-white/30 bg-white/20"
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      />
    </span>
  );
}

/**
 * Aspect-ratio selector — opens UPWARD with Radix Popover, shows a shape
 * preview + description per option, turquoise checkmark on selected.
 */
export default function AspectRatioDropdown({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: AspectRatioDropdownProps) {
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
          aria-label="Aspect ratio"
          aria-haspopup="listbox"
          aria-expanded={controlledOpen}
          className="flex h-8 items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.05)] px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[rgba(255,255,255,0.08)] focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <RectangleHorizontal className="size-4" />
          <span className="min-w-[40px] text-center">{value}</span>
          <ChevronDown className="size-3 text-neutral-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer || document.body}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[220px] pointer-events-auto"
        >
          {ASPECT_RATIO_OPTIONS.map((opt) => {
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
                  selected
                    ? "bg-[#131517]"
                    : "hover:bg-[#131517]"
                }`}
              >
                <ShapeIcon shape={opt.shape} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {opt.value}
                  </span>
                  <span className="block truncate text-xs text-gray-400">
                    {opt.description}
                  </span>
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

"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";

interface Veo31AspectRatioControlProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

/** Google Veo 3.1 Lite-specific aspect ratio options (only 9:16 and 16:9). */
const VEO31_ASPECT_RATIOS = [
  { value: "9:16", description: "Stories/Reels" },
  { value: "16:9", description: "Widescreen" },
];

/** Exact reference SVGs (verbatim) — a tall rounded rect for 9:16, a wide rounded rect for 16:9. */
function AspectIcon({ value }: { value: string }) {
  if (value === "9:16") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="size-4">
        <path
          d="M13 12.5C13 13.8807 11.8807 15 10.5 15L4.5 15C3.11929 15 2 13.8807 2 12.5L2 3.5C2 2.11929 3.11929 1 4.5 1L10.5 1C11.8807 1 13 2.11929 13 3.5L13 12.5ZM12 3.5C12 2.67157 11.3284 2 10.5 2L4.5 2C3.67157 2 3 2.67157 3 3.5L3 12.5C3 13.3284 3.67157 14 4.5 14L10.5 14C11.3284 14 12 13.3284 12 12.5L12 3.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="size-4">
      <path
        d="M13.833 3.5C14.8454 3.5 15.6658 4.32064 15.666 5.33301V10.667C15.6658 11.6794 14.8454 12.5 13.833 12.5H3.16602C2.1539 12.4996 1.33318 11.6791 1.33301 10.667V5.33301C1.33318 4.32085 2.1539 3.50035 3.16602 3.5H13.833ZM3.16602 4.5C2.70619 4.50035 2.33318 4.87314 2.33301 5.33301V10.667C2.33318 11.1269 2.70619 11.4996 3.16602 11.5H13.833C14.2931 11.5 14.6658 11.1271 14.666 10.667V5.33301C14.6658 4.87292 14.2931 4.5 13.833 4.5H3.16602Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Google Veo 3.1 Lite Aspect Ratio control — 2 options (9:16 default, 16:9),
 * reusing the shared aspectRatio state (not isolated per-model, unlike Kling 3.0 Turbo).
 */
export default function Veo31AspectRatioControl({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: Veo31AspectRatioControlProps) {
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
          className="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <AspectIcon value={value} />
          <span className="min-w-[24px]">{value}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[200px] pointer-events-auto"
        >
          {VEO31_ASPECT_RATIOS.map((opt) => {
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
                <AspectIcon value={opt.value} />
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

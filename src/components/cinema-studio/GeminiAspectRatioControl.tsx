"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";

interface GeminiAspectRatioControlProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

/** Gemini-specific aspect ratio options (only 16:9 and 9:16) */
const GEMINI_ASPECT_RATIOS = [
  { value: "16:9", description: "Widescreen", shape: [16, 9] as [number, number] },
  { value: "9:16", description: "Stories/Reels", shape: [9, 16] as [number, number] },
];

/** Dynamic aspect ratio icon that renders the actual shape. */
function DynamicAspectIcon({ value }: { value: string }) {
  const option = GEMINI_ASPECT_RATIOS.find(opt => opt.value === value);
  if (!option) return null;

  const [w, h] = option.shape;
  const scale = 14 / Math.max(w, h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="text-neutral-400"
      style={{ color: "currentColor" }}
    >
      <rect
        x={(16 - width) / 2}
        y={(16 - height) / 2}
        width={width}
        height={height}
        rx="1"
        fill="currentColor"
      />
    </svg>
  );
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
 * Gemini-specific Aspect Ratio control with dynamic icon.
 * Opens upward with Radix Popover showing shape preview + description,
 * turquoise checkmark on selected option.
 */
export default function GeminiAspectRatioControl({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: GeminiAspectRatioControlProps) {
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
          <DynamicAspectIcon value={value} />
          <span className="min-w-[24px]">{value}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[220px] pointer-events-auto transition-all duration-200 ease-out origin-bottom data-[state=open]:animate-popover-smooth-in data-[state=closed]:animate-popover-smooth-out"
        >
          {GEMINI_ASPECT_RATIOS.map((opt) => {
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

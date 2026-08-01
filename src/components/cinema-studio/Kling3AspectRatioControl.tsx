"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";

interface Kling3AspectRatioControlProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

/** Kling 3.0-specific aspect ratio options (only 1:1, 16:9, 9:16). */
const KLING3_ASPECT_RATIOS = [
  { value: "1:1", description: "Square", shape: [1, 1] as [number, number] },
  { value: "16:9", description: "Widescreen", shape: [16, 9] as [number, number] },
  { value: "9:16", description: "Stories/Reels", shape: [9, 16] as [number, number] },
];

/** Dynamic aspect ratio icon that renders the actual shape. */
function DynamicAspectIcon({ value }: { value: string }) {
  const option = KLING3_ASPECT_RATIOS.find((opt) => opt.value === value);
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
 * Kling 3.0-specific Aspect Ratio control with dynamic icon.
 * Opens upward with Radix Popover showing shape preview + description,
 * turquoise checkmark on selected option. Mirrors GeminiAspectRatioControl.
 */
export default function Kling3AspectRatioControl({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: Kling3AspectRatioControlProps) {
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
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[#181a1d] focus:outline-none focus:ring-2 focus:ring-[#D97757]"
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
          className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#141618]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-[220px]"
        >
          {KLING3_ASPECT_RATIOS.map((opt) => {
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
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-150 ${
                  selected
                    ? "bg-white/10 text-white font-semibold"
                    : "text-white/80 hover:bg-white/5 hover:text-white"
                }`}
              >
                <DynamicAspectIcon value={opt.value} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {opt.value}
                  </span>
                  <span className="block truncate text-xs text-white/50">
                    {opt.description}
                  </span>
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

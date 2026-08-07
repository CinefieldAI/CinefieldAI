"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useListboxNav } from "@/hooks/useListboxNav";
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
  const shape =
    value === "9:16"
      ? [9, 16]
      : value === "1:1"
        ? [1, 1]
        : value === "4:3"
          ? [4, 3]
          : value === "3:4"
            ? [3, 4]
            : value === "21:9"
              ? [21, 9]
              : [16, 9];
  const [w, h] = shape;
  const scale = 14 / Math.max(w, h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);

  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span
        className="rounded-[2px] border-[1.5px] border-white/70"
        style={{
          width: Math.max(6, width),
          height: Math.max(6, height),
        }}
      />
    </span>
  );
}

/** Small rectangle preview shaped to the option's aspect ratio. */
function ShapeIcon({ shape, active }: { shape: [number, number]; active?: boolean }) {
  const [w, h] = shape;
  const scale = 20 / Math.max(w, h);
  return (
    <span className="flex h-6 w-8 shrink-0 items-center justify-center">
      <span
        className="rounded-[2px] border-[1.5px]"
        style={{
          width: Math.round(w * scale),
          height: Math.round(h * scale),
          borderColor: active ? "#D97757" : "rgba(255,255,255,0.45)",
        }}
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

  const isModified = value !== "16:9";

  const handleOpenChange = (newOpen: boolean) => {
    if (isOpen === undefined) setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  const nav = useListboxNav({
    count: KLING3_ASPECT_RATIOS.length,
    selectedIndex: KLING3_ASPECT_RATIOS.findIndex((opt) => opt.value === value),
    open: controlledOpen,
    onActivate: (index) => {
      const opt = KLING3_ASPECT_RATIOS[index];
      if (!opt) return;
      onChange(opt.value);
    },
    onSelect: (index) => {
      const opt = KLING3_ASPECT_RATIOS[index];
      if (!opt) return;
      onChange(opt.value);
      handleOpenChange(false);
    },
  });

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Aspect ratio"
          aria-haspopup="listbox"
          aria-expanded={controlledOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            controlledOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
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
          onKeyDown={nav.handleKeyDown}
          onOpenAutoFocus={nav.handleOpenAutoFocus}
          onEscapeKeyDown={nav.handleEscapeKeyDown}
          className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#18191c]/95 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.75)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-[210px]"
        >
          <p className="px-2 py-1.5 text-xs font-semibold text-white/70">Aspect ratio</p>
          <div role="listbox" aria-label="Select ratio" className="hide-scrollbar max-h-[min(70vh,560px)] overflow-y-auto">
          {KLING3_ASPECT_RATIOS.map((opt, index) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                {...nav.getOptionProps(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  handleOpenChange(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-all duration-150 ${
                  selected
                    ? "bg-[#24262b] font-semibold text-white"
                    : nav.activeIndex === index
                      ? "bg-white/5 text-white"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                }`}
              >
                <ShapeIcon shape={opt.shape} active={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {opt.value}
                  </span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
              </button>
            );
          })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

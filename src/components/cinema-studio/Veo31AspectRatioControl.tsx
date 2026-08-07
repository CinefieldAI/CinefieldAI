"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useListboxNav } from "@/hooks/useListboxNav";
import { Check, Sparkles } from "lucide-react";

interface Veo31AspectRatioControlProps {
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
  /** Hides the "Auto" option (e.g. OpenAI Sora 2, which only has 16:9/9:16). Defaults to true (Veo 3.1 Lite's existing behavior). */
  includeAuto?: boolean;
}

/** Google Veo 3.1 Lite-specific aspect ratio options — confirmed via live click-audit: Auto (default), 16:9, 9:16. */
const VEO31_ASPECT_RATIOS = [
  { value: "auto", description: "Recommended" },
  { value: "16:9", description: "Widescreen" },
  { value: "9:16", description: "Stories/Reels" },
];

function ShapeIcon({ value, active }: { value: string; active?: boolean }) {
  if (value === "auto") {
  return (
      <span className="flex h-6 w-8 shrink-0 items-center justify-center">
        <span
          className="rounded-[2px] border-[1.5px]"
          style={{
            width: 20,
            height: 20,
            borderColor: active ? "#D97757" : "rgba(255,255,255,0.45)",
          }}
        />
      </span>
    );
  }
  const shape = value === "9:16" ? [9, 16] : [16, 9];
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
 * Google Veo 3.1 Lite Aspect Ratio control — 2 options (9:16 default, 16:9),
 * reusing the shared aspectRatio state (not isolated per-model, unlike Kling 3.0 Turbo).
 */
export default function Veo31AspectRatioControl({
  value,
  onChange,
  onOpenChange,
  isOpen,
  portalContainer,
  includeAuto = true,
}: Veo31AspectRatioControlProps) {
  const [open, setOpen] = useState(false);
  const controlledOpen = isOpen !== undefined ? isOpen : open;
  const options = includeAuto
    ? VEO31_ASPECT_RATIOS
    : VEO31_ASPECT_RATIOS.filter((opt) => opt.value !== "auto");

  const isModified = value !== "16:9";

  const handleOpenChange = (newOpen: boolean) => {
    if (isOpen === undefined) setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  const nav = useListboxNav({
    count: options.length,
    selectedIndex: options.findIndex((opt) => opt.value === value),
    open: controlledOpen,
    onActivate: (index) => {
      const opt = options[index];
      if (!opt) return;
      onChange(opt.value);
    },
    onSelect: (index) => {
      const opt = options[index];
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
          <ShapeIcon value={value} />
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
          {options.map((opt, index) => {
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
                <ShapeIcon value={opt.value} active={selected} />
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

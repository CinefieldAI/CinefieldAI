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
  /** Restricts the option list (e.g. HappyHorse's 5 options, no "Auto"/"21:9"). Defaults to the full ASPECT_RATIO_OPTIONS list. */
  options?: string[];
}

/** Small rectangle preview shaped to the option's aspect ratio — thin outline
 *  only, no filled background box, matching the shared createImage ratio icon. */
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
  options,
}: AspectRatioDropdownProps) {
  const [open, setOpen] = useState(false);
  const controlledOpen = isOpen !== undefined ? isOpen : open;
  const visibleOptions = options
    ? ASPECT_RATIO_OPTIONS.filter((opt) => options.includes(opt.value))
    : ASPECT_RATIO_OPTIONS;

  const defaultRatio = visibleOptions[0]?.value ?? "16:9";
  const isModified = value !== defaultRatio;

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
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            controlledOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)] shadow-[0_0_12px_rgba(217,119,87,0.40)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
        >
          <DynamicAspectIcon value={value} />
          <span className="min-w-[40px] text-center">{value}</span>
          <ChevronDown className="size-3 text-neutral-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-white/10 bg-[#18191c]/95 p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.75)] backdrop-blur-xl pointer-events-auto transition-all duration-200 ease-out origin-bottom animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-[210px]"
        >
          {visibleOptions.map((opt) => {
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
                    ? "bg-[#24262b] text-white font-semibold border border-white/10"
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

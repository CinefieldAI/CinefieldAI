"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

interface KlingSceneControlProps {
  value: string;
  onChange: (value: string) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Overrides the option list (e.g. Kling Motion Control's is Off/Video/Image). Defaults to the locked Kling 3.0 Motion Control list. */
  options?: string[];
  /** Overrides the trigger label (default "Scene Control", matches the locked caller). */
  label?: string;
  /** Shows the current value inline in the trigger, next to the label (off by default, matches the locked caller). */
  showValue?: boolean;
}

const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

const SCENE_OPTIONS = ["Off", "Light", "Medium", "Heavy"];

export default function KlingSceneControl({
  value,
  onChange,
  isOpen: externalIsOpen,
  onOpenChange: externalOnOpenChange,
  portalContainer,
  options = SCENE_OPTIONS,
  label = "Scene Control",
  showValue = false,
}: KlingSceneControlProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalOpen;

  const handleOpenChange = (newOpen: boolean) => {
    if (externalIsOpen === undefined) setInternalOpen(newOpen);
    externalOnOpenChange?.(newOpen);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Scene Control"
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            isOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)] shadow-[0_0_12px_rgba(217,119,87,0.40)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
        >
          {label}
          {showValue && <span className="font-semibold text-[#D97757]">{value}</span>}
          <ChevronDown className="size-3 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[120px] pointer-events-auto"
        >
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
                className={`w-full px-3 py-2 text-left text-xs font-medium rounded-lg transition-colors ${
                  selected ? "bg-[#131517] text-[#00e5ff]" : "text-white hover:bg-[#131517]"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

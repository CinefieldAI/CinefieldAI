"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Layers } from "lucide-react";

interface Kling3MultiShotControlProps {
  value: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
}

/** Kling 3.0's only currently-supported Multi-shot mode. */
const MULTI_SHOT_OPTIONS = [{ value: "custom", label: "Custom" }];

/** Kling 3.0 Multi-shot trigger + panel. Accent-colored value, per spec. */
export default function Kling3MultiShotControl({
  value,
  onChange,
  isOpen,
  onOpenChange,
  portalContainer,
}: Kling3MultiShotControlProps) {
  const selectedLabel =
    MULTI_SHOT_OPTIONS.find((opt) => opt.value === value)?.label ?? "Custom";

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Multi-shot"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <Layers className="size-3.5 text-neutral-400" />
          Multi-shot
          <span className="font-semibold text-[#00e5ff]">{selectedLabel}</span>
          <ChevronDown className="size-3 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[180px] pointer-events-auto"
        >
          <div className="px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Multi-shot
            </span>
          </div>
          {MULTI_SHOT_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  onOpenChange(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selected ? "bg-[#131517]" : "hover:bg-[#131517]"
                }`}
              >
                <span className="text-sm font-medium text-white">{opt.label}</span>
                {selected && <Check className="size-4 shrink-0 text-[#00e5ff]" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

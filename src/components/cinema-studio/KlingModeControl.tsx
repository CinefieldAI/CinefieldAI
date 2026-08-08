"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";

interface KlingModeControlProps {
  value: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Kling 3.0 Omni: Frames/Elements. Kling O1 Video: Frames only (fixed, no real alternative confirmed). */
  options: { value: string; label: string }[];
}

/** Verbatim reference icon — center panel with two side brackets (Frames/Elements mode). */
function ModeIcon() {
  return (
    <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none" className="size-3.5 text-neutral-400">
      <path
        d="M17.5 5.75H20.25C20.8023 5.75 21.25 6.19772 21.25 6.75V17.25C21.25 17.8023 20.8023 18.25 20.25 18.25H17.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 3.75H7.5C6.94772 3.75 6.5 4.19772 6.5 4.75V19.25C6.5 19.8023 6.94771 20.25 7.5 20.25H16.5C17.0523 20.25 17.5 19.8023 17.5 19.25V4.75C17.5 4.19772 17.0523 3.75 16.5 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 18.25H3.75C3.19772 18.25 2.75 17.8023 2.75 17.25V6.75C2.75 6.19771 3.19772 5.75 3.75 5.75H6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mode chip shared by Kling 3.0 Omni and Kling O1 Video — cyan state label, chevron. */
export default function KlingModeControl({
  value,
  onChange,
  isOpen,
  onOpenChange,
  portalContainer,
  options,
}: KlingModeControlProps) {
  const selectedLabel = options.find((opt) => opt.value === value)?.label ?? options[0].label;

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Mode"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            isOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
        >
          <ModeIcon />
          Mode
          <span className="font-semibold text-[#D97757]">{selectedLabel}</span>
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
            <span className="text-xs font-semibold tracking-wider text-gray-400">
              Mode
            </span>
          </div>
          {options.map((opt) => {
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
                {selected && <Check className="size-4 shrink-0 text-[#D97757]" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

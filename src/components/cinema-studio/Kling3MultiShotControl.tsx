"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";

interface Kling3MultiShotControlProps {
  value: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
  /** Overrides the option list (e.g. Kling 3.0 Omni's Multi-shot is Off-only). Defaults to Kling 3.0's Auto-only list. */
  options?: { value: string; label: string }[];
}

/** Verbatim reference icon — outlined frame with a small "+" badge (storyboard/multi-shot). */
function StoryboardIcon() {
  return (
    <svg aria-hidden="true" width="24px" height="24px" viewBox="0 0 24 24" fill="none" className="size-3.5 text-neutral-400">
      <path
        d="M12 19.25V20C12.4142 20 12.75 19.6642 12.75 19.25H12ZM20.5 10.25C20.5 10.6642 20.8358 11 21.25 11C21.6642 11 22 10.6642 22 10.25H20.5ZM12.75 5C12.75 4.58579 12.4142 4.25 12 4.25C11.5858 4.25 11.25 4.58579 11.25 5H12.75ZM3.5 18.25V5.75H2V18.25H3.5ZM12 18.5H3.75V20H12V18.5ZM20.5 5.75V10.25H22V5.75H20.5ZM12.75 19.25V5H11.25V19.25H12.75ZM22 5.75C22 4.7835 21.2165 4 20.25 4V5.5C20.3881 5.5 20.5 5.61193 20.5 5.75H22ZM3.5 5.75C3.5 5.61193 3.61193 5.5 3.75 5.5V4C2.7835 4 2 4.7835 2 5.75H3.5ZM2 18.25C2 19.2165 2.7835 20 3.75 20V18.5C3.61193 18.5 3.5 18.3881 3.5 18.25H2ZM3.75 5.5H20.25V4H3.75V5.5Z"
        fill="currentColor"
      />
      <path
        d="M19.75 13.75C19.75 13.3358 19.4142 13 19 13C18.5858 13 18.25 13.3358 18.25 13.75H19.75ZM18.25 20.25C18.25 20.6642 18.5858 21 19 21C19.4142 21 19.75 20.6642 19.75 20.25H18.25ZM15.75 16.25C15.3358 16.25 15 16.5858 15 17C15 17.4142 15.3358 17.75 15.75 17.75V16.25ZM22.25 17.75C22.6642 17.75 23 17.4142 23 17C23 16.5858 22.6642 16.25 22.25 16.25V17.75ZM18.25 13.75V17H19.75V13.75H18.25ZM18.25 17V20.25H19.75V17H18.25ZM15.75 17.75H19V16.25H15.75V17.75ZM19 17.75H22.25V16.25H19V17.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Kling 3.0's only currently-supported Multi-shot mode. */
const MULTI_SHOT_OPTIONS = [{ value: "custom", label: "Auto" }];

/** Kling 3.0 Multi-shot trigger + panel. Accent-colored value, per spec (gray for "off"). */
export default function Kling3MultiShotControl({
  value,
  onChange,
  isOpen,
  onOpenChange,
  portalContainer,
  options = MULTI_SHOT_OPTIONS,
}: Kling3MultiShotControlProps) {
  const selectedLabel =
    options.find((opt) => opt.value === value)?.label ?? options[0].label;
  const isOff = value === "off";

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Multi-shot"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            isOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
        >
          <StoryboardIcon />
          Multi-shot
          <span className={`font-semibold ${isOff ? "text-neutral-400" : "text-[#D97757]"}`}>
            {selectedLabel}
          </span>
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
              Multi-shot
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

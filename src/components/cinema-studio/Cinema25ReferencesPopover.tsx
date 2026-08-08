"use client";

import * as Popover from "@radix-ui/react-popover";
import { Image as ImageIcon, Plus } from "lucide-react";
import { StartFrameIcon, EndFrameIcon } from "./ReferencesControl";

interface Cinema25ReferencesPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: "reference" | "startFrame" | "endFrame") => void;
  portalContainer?: HTMLElement | null;
}

const OPTIONS: {
  mode: "reference" | "startFrame" | "endFrame";
  label: string;
  icon: React.ReactNode;
}[] = [
  { mode: "reference", label: "As Reference", icon: <ImageIcon className="size-4" aria-hidden /> },
  { mode: "startFrame", label: "As Start Frame", icon: <StartFrameIcon /> },
  { mode: "endFrame", label: "As End Frame", icon: <EndFrameIcon /> },
];

/**
 * Cinema Studio 2.5's "+" References popover — exactly three options (As
 * Reference / As Start Frame / As End Frame), no Uploads/Elements/Filter/etc.
 * Deliberately separate from the shared ReferencesControl (different classes,
 * different option count) and from the global AssetsPickerModal.
 */
export default function Cinema25ReferencesPopover({
  isOpen,
  onOpenChange,
  onSelect,
  portalContainer,
}: Cinema25ReferencesPopoverProps) {
  const select = (mode: "reference" | "startFrame" | "endFrame") => {
    onSelect(mode);
    onOpenChange(false);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="References"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className="flex h-8 items-center justify-center rounded-lg border border-[rgba(217,119,87,0.45)] bg-[#101112] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-[#D97757] hover:bg-[#181a1d] focus:outline-none"
        >
          <Plus className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={8}
          className="z-[100000] w-[180px] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] p-0.5 shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur pointer-events-auto"
        >
          <div className="flex h-[26px] w-full items-center rounded-[10px] px-2 pb-0.5 pt-1.5">
            <span className="text-xs-medium text-font-secondary">References</span>
          </div>
          {OPTIONS.map((option) => (
            <div key={option.mode} className="flex w-full items-center p-0.5">
              <button
                type="button"
                onClick={() => select(option.mode)}
                className="flex min-h-10 w-full min-w-0 items-center gap-1 rounded-md p-2 text-left text-font-primary transition-colors hover:bg-neutral-primary-reverted-10 active:bg-neutral-primary-reverted-20 svg:shrink-0 svg:text-icon-primary"
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate px-1 text-sm-medium">{option.label}</span>
              </button>
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

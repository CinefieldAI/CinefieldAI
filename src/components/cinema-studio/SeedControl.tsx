"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Dices } from "lucide-react";

interface SeedControlProps {
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  seed: number | null;
  onSeedChange: (seed: number | null) => void;
  onOpenChange?: (open: boolean) => void;
  isOpen?: boolean;
  portalContainer?: HTMLElement | null;
}

/** Verbatim reference icon — the lock/unlock padlock inside the Seed popover (Higgsfield family). */
function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="size-5">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.37353 3.86719C5.40823 3.86719 4.625 4.6498 4.625 5.61426V5.67448C4.625 6.64098 5.4085 7.42448 6.375 7.42448C7.3415 7.42448 8.125 6.64097 8.125 5.67448V5.61719C8.125 4.65111 7.34046 3.86719 6.37353 3.86719ZM3.67044 5.11426C3.90581 3.83555 5.02746 2.86719 6.37353 2.86719C7.89189 2.86718 9.125 4.09798 9.125 5.61719V5.67448C9.125 7.19326 7.89378 8.42448 6.375 8.42448C5.00591 8.42448 3.87048 7.42399 3.65998 6.11426H1.875C1.59886 6.11426 1.375 5.8904 1.375 5.61426C1.375 5.33811 1.59886 5.11426 1.875 5.11426H3.67044ZM10 5.61426C10 5.33811 10.2239 5.11426 10.5 5.11426H16.125C16.4011 5.11426 16.625 5.33811 16.625 5.61426C16.625 5.8904 16.4011 6.11426 16.125 6.11426H10.5C10.2239 6.11426 10 5.8904 10 5.61426ZM10.8735 12.1172C9.90823 12.1172 9.125 12.8998 9.125 13.8643C9.125 14.8316 9.90935 15.6172 10.875 15.6172C11.8415 15.6172 12.625 14.8337 12.625 13.8672C12.625 12.9011 11.8405 12.1172 10.8735 12.1172ZM8.17044 13.3643C8.40581 12.0855 9.52746 11.1172 10.8735 11.1172C12.3919 11.1172 13.625 12.348 13.625 13.8672C13.625 15.386 12.3938 16.6172 10.875 16.6172C9.52626 16.6172 8.40538 15.6443 8.17034 14.3643H1.875C1.59886 14.3643 1.375 14.1404 1.375 13.8643C1.375 13.5881 1.59886 13.3643 1.875 13.3643H8.17044ZM14.5 13.8643C14.5 13.5881 14.7239 13.3643 15 13.3643H16.125C16.4011 13.3643 16.625 13.5881 16.625 13.8643C16.625 14.1404 16.4011 14.3643 16.125 14.3643H15C14.7239 14.3643 14.5 14.1404 14.5 13.8643Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Higgsfield family's Seed chip — icon-only trigger, opens a "Seed" popover
 * with a Random/locked-number field and a lock toggle. No verbatim trigger
 * icon was captured (only the popover's lock icon), so the trigger uses a
 * generic dice icon rather than an invented custom path.
 */
export default function SeedControl({
  locked,
  onLockedChange,
  seed,
  onSeedChange,
  onOpenChange,
  isOpen,
  portalContainer,
}: SeedControlProps) {
  const [open, setOpen] = useState(false);
  const controlledOpen = isOpen !== undefined ? isOpen : open;

  const handleOpenChange = (newOpen: boolean) => {
    if (isOpen === undefined) setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  const displayValue = locked ? String(seed ?? 1) : "Random";

  return (
    <Popover.Root open={controlledOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Seed"
          aria-haspopup="dialog"
          aria-expanded={controlledOpen}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-neutral-400 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <Dices className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={8}
          className="z-[100001] rounded-2xl border border-[rgba(217,217,217,0.04)] bg-[rgba(35,38,42,0.75)] shadow-[0_4px_4px_rgba(0,0,0,0.12)] backdrop-blur pointer-events-auto"
        >
          <div className="flex min-w-[240px] max-w-[268px] flex-col gap-4 p-4">
            <div className="flex flex-row items-center justify-between gap-1">
              <span className="text-xs text-neutral-400">Seed</span>
              <label className="flex h-9 w-full items-center gap-1 text-sm text-neutral-300">
                <div className="relative flex h-full w-full items-center rounded-lg border border-[#424242] px-3 text-left outline-none hover:border-white/24">
                  <input
                    readOnly={!locked}
                    type="text"
                    value={displayValue}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ""));
                      onSeedChange(Number.isFinite(n) ? n : null);
                    }}
                    className="h-full w-full bg-transparent text-white outline-none"
                  />
                  <button
                    type="button"
                    aria-label={locked ? "Unlock seed" : "Lock seed"}
                    onClick={() => onLockedChange(!locked)}
                    className={`ml-1 flex items-center justify-center transition-colors ${
                      locked ? "text-[#00e5ff]" : "text-white/60 hover:text-white/70"
                    }`}
                  >
                    <LockIcon />
                  </button>
                </div>
              </label>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

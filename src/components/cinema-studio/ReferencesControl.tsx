"use client";

import * as Popover from "@radix-ui/react-popover";

interface ReferencesControlProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectReferenceMode: (mode: "startFrame" | "endFrame") => void;
  portalContainer?: HTMLElement | null;
  /** Hides "As End Frame" for single-slot models (default true, matches the existing two-option behavior). */
  showEndFrame?: boolean;
}

/** Verbatim reference plus icon (stroke-based, not lucide's filled Plus). */
function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
        d="M12 5.25V12m0 0v6.75M12 12H5.25M12 12h6.75"
      />
    </svg>
  );
}

/** Verbatim reference icon — frame with an arrow passing right through it — "As Start Frame". */
export function StartFrameIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M13 8.75 16.25 12 13 15.25M7.75 12h7.75m3.75-8.25H4.75a1 1 0 0 0-1 1v14.5a1 1 0 0 0 1 1h14.5a1 1 0 0 0 1-1V4.75a1 1 0 0 0-1-1"
      />
    </svg>
  );
}

/** Verbatim reference icon — frame with an arrow passing left through it — "As End Frame". */
export function EndFrameIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M11 15.25 7.75 12 11 8.75M16.25 12H8.5m10.75-8.25H4.75a1 1 0 0 0-1 1v14.5a1 1 0 0 0 1 1h14.5a1 1 0 0 0 1-1V4.75a1 1 0 0 0-1-1"
      />
    </svg>
  );
}

/**
 * References trigger ("+") — opens a choice popover (As Start Frame / As End
 * Frame) before handing off to the Assets picker. Shared by Kling 3.0 and
 * Google Veo 3.1 Lite (generalized from the original Kling-only component).
 */
export default function ReferencesControl({
  isOpen,
  onOpenChange,
  onSelectReferenceMode,
  portalContainer,
  showEndFrame = true,
}: ReferencesControlProps) {
  const select = (mode: "startFrame" | "endFrame") => {
    onSelectReferenceMode(mode);
    onOpenChange(false);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="References"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-neutral-400 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
        >
          <PlusIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] overflow-hidden rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-1 w-[220px] pointer-events-auto"
        >
          <div className="px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              References
            </span>
          </div>
          <button
            type="button"
            onClick={() => select("startFrame")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#131517]"
          >
            <span className="text-neutral-400">
              <StartFrameIcon />
            </span>
            <span className="text-sm font-medium text-white">As Start Frame</span>
          </button>
          {showEndFrame && (
            <button
              type="button"
              onClick={() => select("endFrame")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#131517]"
            >
              <span className="text-neutral-400">
                <EndFrameIcon />
              </span>
              <span className="text-sm font-medium text-white">As End Frame</span>
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import type { HTMLAttributes } from "react";

interface PromptResizeHandlesProps {
  verticalHandleProps: HTMLAttributes<HTMLDivElement>;
  cornerHandleProps: HTMLAttributes<HTMLDivElement>;
  isResizing: boolean;
  verticalLabel: string;
  cornerLabel: string;
}

export default function PromptResizeHandles({
  verticalHandleProps,
  cornerHandleProps,
  isResizing,
  verticalLabel,
  cornerLabel,
}: PromptResizeHandlesProps) {
  return (
    <>
      <div
        {...verticalHandleProps}
        aria-label={verticalLabel}
        className="group absolute inset-x-0 top-0 z-20 flex h-6 cursor-ns-resize touch-none items-start justify-center pt-1 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={`prompt-resize-horizontal-breathe h-[5px] w-16 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.55)] transition-[background-color,box-shadow] duration-150 ${
            isResizing
              ? "bg-white/45 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_1px_3px_rgba(0,0,0,0.65)]"
              : "bg-white/20 group-hover:bg-white/35 group-focus-visible:bg-white/35"
          }`}
        />
      </div>

      <div
        {...cornerHandleProps}
        aria-label={cornerLabel}
        className="group absolute right-0 top-0 z-30 flex h-11 w-11 cursor-nesw-resize touch-none items-start justify-end p-2 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={`prompt-resize-corner-breathe h-4 w-4 rounded-tr-[5px] border-r-2 border-t-2 shadow-[1px_-1px_1px_rgba(0,0,0,0.35)] transition-[border-color,filter] duration-150 ${
            isResizing
              ? "border-white/50 brightness-125"
              : "border-white/20 group-hover:border-white/40 group-focus-visible:border-white/40"
          }`}
        />
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

interface StyleCardPopoverProps {
  onOpen?: () => void;
}

export default function StyleCardPopover({
  onOpen,
}: StyleCardPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) onOpen?.(); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors"
        >
          Style
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className="z-[100000] w-[480px] rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-6 px-6 shadow-xl max-h-96 overflow-y-auto"
        >
          <h3 className="text-white font-bold text-lg mb-1">
            CREATE A MOODBOARD FROM YOUR REFERENCES
          </h3>
          <p className="text-white/70 text-sm mb-4">
            Create a clear moodboard from your references.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-[#CCFF00] text-black font-medium text-sm hover:opacity-90 transition-opacity mb-4"
          >
            Build your moodboard +
          </button>
          <div className="flex gap-2 mb-4 border-b border-white/10 pb-3">
            <button type="button" className="text-xs text-white font-medium">Curated</button>
            <button type="button" className="text-xs text-white/50 hover:text-white">My Moodboards</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["New Indie", "Underwater", "80s horror", "Disposable camera", "Neutral pastel film", "Warm vivid film"].map(
              (style) => (
                <div
                  key={style}
                  className="aspect-square rounded-lg bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <span className="text-[10px] text-center text-white/60 px-1">{style}</span>
                </div>
              )
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

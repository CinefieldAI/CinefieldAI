"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

interface CharacterCardPopoverProps {
  onOpen?: () => void;
}

export default function CharacterCardPopover({
  onOpen,
}: CharacterCardPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) onOpen?.(); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors"
        >
          Character
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className="z-[100000] w-96 rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-6 px-6 shadow-xl"
        >
          <h3 className="text-white font-bold text-lg mb-2">
            MAKE YOUR OWN CHARACTER
          </h3>
          <p className="text-white/70 text-sm mb-4">
            Upload photos from multiple angles to train your character. Then use the same consistent character across new images and videos.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-[#CCFF00] text-black font-medium text-sm hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            Create character +
          </button>
          <div className="mt-6 flex gap-1 mb-3">
            <button type="button" className="text-xs text-white/50 hover:text-white">All</button>
            <button type="button" className="text-xs text-white/50 hover:text-white">Soul</button>
            <button type="button" className="text-xs text-white font-medium">Soul 2.0</button>
          </div>
          <div className="text-center text-white/50 text-xs">
            No characters yet. Create your first one!
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

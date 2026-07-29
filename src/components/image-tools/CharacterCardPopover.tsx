"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus } from "lucide-react";

interface CharacterCardPopoverProps {
  onOpen?: () => void;
}

/** 80x80 Character card (Higgsfield Soul 2.0) — the whole card is the
 *  single semantic trigger button; the plus glyph is a decorative span,
 *  never a nested interactive element. */
export default function CharacterCardPopover({
  onOpen,
}: CharacterCardPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) onOpen?.(); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Add or select character"
          className="group relative flex h-20 w-20 shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-xl p-1.5 text-left transition-transform hover:scale-[1.02]"
          style={{
            background: "linear-gradient(180deg, #2a2d31 0%, #17191b 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px rgba(255,255,255,0.04), 0 4px 12px rgba(0,0,0,0.32)",
          }}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white"
          >
            <Plus className="h-3 w-3" />
          </span>
          <span className="text-[12px] font-bold uppercase leading-none tracking-wide text-white">
            Character
          </span>
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

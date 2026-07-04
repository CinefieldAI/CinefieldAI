"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

interface ColorTransferPopoverProps {
  onOpen?: () => void;
}

export default function ColorTransferPopover({
  onOpen,
}: ColorTransferPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors"
        >
          Color Transfer
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className="z-[100000] w-96 rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-6 px-6 shadow-xl"
        >
          <h3 className="text-white font-bold text-lg mb-2">
            CONTROL YOUR COLORS WITH SOUL HEX
          </h3>
          <p className="text-white/70 text-sm mb-4">
            Upload a reference image and let Soul HEX bring its colors in your own style
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-[#CCFF00] text-black font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Upload & Create +
          </button>
          <div className="mt-6 text-center text-white/50 text-xs">
            Ready to Create Your Hex?<br />
            Saved hex cards will appear here. No hex yet — upload an image to begin.
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

"use client";

import { Lock } from "lucide-react";

export default function KlingPromptDisabled() {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 rounded-[24px] bg-[#1a1d1f] p-3">
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-neutral-400" />
        <span className="text-xs font-medium text-neutral-400">Prompt disabled</span>
      </div>
      <div className="text-xs text-neutral-500">
        Motion Control uses the scene description from Advanced Settings instead.
      </div>
    </div>
  );
}

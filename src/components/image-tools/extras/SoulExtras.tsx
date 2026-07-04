"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

export default function SoulExtras() {
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      {/* Character card */}
      <div className="flex gap-2 items-center">
        <label className="text-xs font-semibold text-zinc-400 w-20">
          Character
        </label>
        <button
          type="button"
          className={`flex-1 h-10 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
            selectedCharacter
              ? "border-[#E61E8F] bg-[#E61E8F]/10 text-[#E61E8F]"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
          }`}
        >
          <Plus className="h-4 w-4" />
          <span className="text-xs font-medium">
            {selectedCharacter || "Add character"}
          </span>
        </button>
      </div>

      {/* Style card */}
      <div className="flex gap-2 items-center">
        <label className="text-xs font-semibold text-zinc-400 w-20">
          Style
        </label>
        <button
          type="button"
          className={`flex-1 h-10 rounded-lg border-2 transition-all flex items-center justify-center gap-2 ${
            selectedStyle
              ? "border-[#E61E8F] bg-[#E61E8F]/10 text-[#E61E8F]"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
          }`}
        >
          <Plus className="h-4 w-4" />
          <span className="text-xs font-medium">
            {selectedStyle || "Add style"}
          </span>
        </button>
      </div>
    </div>
  );
}

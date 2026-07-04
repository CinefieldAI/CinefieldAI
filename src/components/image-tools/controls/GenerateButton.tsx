"use client";

import { Sparkles } from "lucide-react";

interface GenerateButtonProps {
  cost: number;
  onClick: () => void;
  disabled?: boolean;
}

export default function GenerateButton({
  cost,
  onClick,
  disabled = false,
}: GenerateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group relative px-6 py-2.5 rounded-lg bg-[#E61E8F] text-white font-semibold text-sm hover:bg-[#E61E8F]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
    >
      <Sparkles className="h-4 w-4" />
      <span>Generate</span>
      <span className="text-xs font-normal opacity-75">
        ({cost.toFixed(2)} pts)
      </span>
    </button>
  );
}

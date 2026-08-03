"use client";

import { User } from "lucide-react";

interface KlingCharacterCardProps {
  onClick: () => void;
}

export default function KlingCharacterCard({ onClick }: KlingCharacterCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-[rgba(18,19,21,0.95)] px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)] focus:outline-none focus:ring-2 focus:ring-[#D97757]"
    >
      <User className="size-3.5 text-neutral-400" />
      Character
    </button>
  );
}

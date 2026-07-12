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
      className="flex h-7 items-center gap-1.5 rounded-lg bg-card px-3 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
    >
      <User className="size-3.5 text-neutral-400" />
      Character
    </button>
  );
}

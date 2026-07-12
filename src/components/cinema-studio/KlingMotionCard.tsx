"use client";

import { Play } from "lucide-react";

interface KlingMotionCardProps {
  onClick: () => void;
}

export default function KlingMotionCard({ onClick }: KlingMotionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-lg bg-card px-3 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
    >
      <Play className="size-3.5 text-neutral-400" />
      Motion
    </button>
  );
}

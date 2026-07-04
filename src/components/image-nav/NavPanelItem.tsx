"use client";

import Link from "next/link";
import { LucideIcon } from "lucide-react";

interface NavPanelItemProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  badge?: string;
  isActive?: boolean;
  onItemClick?: (toolId: string) => void;
  toolId?: string;
}

export default function NavPanelItem({
  icon: Icon,
  title,
  description,
  href,
  badge,
  isActive = false,
  onItemClick,
  toolId,
}: NavPanelItemProps) {
  const handleClick = () => {
    if (onItemClick && toolId) {
      onItemClick(toolId);
    }
  };

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={`group flex items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-200 ${
        isActive
          ? "bg-white/10 text-white"
          : "hover:bg-white/6 text-zinc-300 hover:text-white"
      }`}
    >
      <div
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          isActive ? "bg-white/15" : "bg-white/8 group-hover:bg-white/12"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {badge && (
            <span className="rounded-full bg-magenta-500/20 px-2 py-0.5 text-[10px] font-semibold text-magenta-300">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 group-hover:text-zinc-400">
          {description}
        </p>
      </div>
    </Link>
  );
}

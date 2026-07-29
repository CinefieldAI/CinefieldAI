"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Gamepad2,
  ShoppingCart,
  Settings,
  Files,
  MessageSquare,
  TrendingUp,
} from "lucide-react";

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <aside
      className="border-r border-white/10 bg-[#0a0a0a] flex flex-col overflow-hidden transition-[width] duration-300"
      style={{ width: collapsed ? 48 : 200 }}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b border-white/10 flex items-center justify-between">
        {!collapsed && (
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">
            Supercomputer
          </h2>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto p-1 hover:bg-white/10 rounded-lg text-neutral-400 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-4">
        <NavButton icon={Plus} label="New task" collapsed={collapsed} />
        <NavButton icon={Search} label="Search" collapsed={collapsed} />
        <NavButton icon={Gamepad2} label="Games" badge="NEW" collapsed={collapsed} />
        <NavButton icon={ShoppingCart} label="Marketplace" collapsed={collapsed} />
        <NavButton icon={Settings} label="Customize" collapsed={collapsed} />
        <NavButton icon={Files} label="Files" collapsed={collapsed} />
        <NavButton icon={MessageSquare} label="Chats" collapsed={collapsed} />
      </nav>

      {/* Bottom */}
      <div className="border-t border-white/10 p-2">
        <button
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#85f02d]/20 hover:bg-[#85f02d]/30 text-[#85f02d] font-semibold text-xs transition-colors border border-[#85f02d]/30 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          {!collapsed && <span>Pricing</span>}
        </button>
      </div>
    </aside>
  );
}

function NavButton({
  icon: Icon,
  label,
  badge,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  badge?: string;
  collapsed?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/5 text-white text-xs font-medium transition-all ${
        collapsed ? "justify-center" : "w-full"
      }`}
      title={collapsed ? label : undefined}
    >
      <Icon className="w-4 h-4" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left truncate">{label}</span>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-sm font-bold bg-[#85f02d] text-[#0a0a0a]">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

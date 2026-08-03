"use client";

import Image from "next/image";
import {
  ArrowDownUp,
  Compass,
  Heart,
  Home,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  icon: LucideIcon;
  gradient: string;
  active?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Home",
    icon: Home,
    gradient: "linear-gradient(135deg, #222221 3.87%, #3B3C3A 93.45%)",
    active: true,
  },
  {
    label: "My elements",
    icon: Compass,
    gradient: "linear-gradient(135deg, #4188BE 3.87%, #0E2772 93.45%)",
  },
  {
    label: "My favorites",
    icon: Heart,
    gradient: "linear-gradient(135deg, #E251B4 3.87%, #8D1237 93.45%)",
  },
  {
    label: "Community feed",
    icon: LayoutGrid,
    gradient: "linear-gradient(135deg, #A5A5A5 3.87%, #3D3D3D 93.45%)",
  },
];

/** Gradient icon box used by every nav item. */
function IconBox({ icon: Icon, gradient }: { icon: LucideIcon; gradient: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: gradient,
        boxShadow:
          "inset 0 1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.45)",
      }}
    >
      <Icon className="size-[18px] text-white" strokeWidth={1.8} />
    </span>
  );
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Collapsible Cinema Studio sidebar (231px ⇄ 52px). Fixed-positioned so the
 * width transition is reliable; the workspace pads its main content to match.
 * Uses the CINEFIELD logo + the site's turquoise accent.
 */
export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      role="navigation"
      aria-label="Cinema Studio"
      className="fixed left-2 top-16 z-30 hidden h-[calc(100vh-80px)] flex-col gap-2 overflow-hidden rounded-[1.25rem] border border-white/[0.04] bg-[#18191C] p-2 md:flex"
      style={{ width: collapsed ? 52 : 231, transition: "width 300ms ease-out" }}
    >
      {/* Header */}
      <div className="flex h-11 items-center justify-between px-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Image
            src="/cinefield-logo.png"
            alt="CINEFIELD"
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-lg object-cover drop-shadow-[0_0_8px_rgba(217,119,87,0.5)]"
          />
          {!collapsed && (
            <span className="truncate text-sm font-semibold text-white">
              Cinema Studio
            </span>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          className="mx-auto flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            className={`flex h-9 items-center gap-3 rounded-xl text-sm font-medium text-white transition-colors hover:bg-white/5 ${
              item.active ? "bg-white/5" : ""
            } ${collapsed ? "justify-center px-0" : "pl-[11px] pr-1.5"}`}
          >
            <IconBox icon={item.icon} gradient={item.gradient} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Projects */}
      <div className="mt-1 border-t border-white/[0.06] pt-2">
        <div className="flex items-center justify-between px-1.5 pb-1">
          {!collapsed && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Projects
            </span>
          )}
          <div className={`flex items-center gap-1 ${collapsed ? "mx-auto" : ""}`}>
            <button
              type="button"
              aria-label="Search projects"
              className="flex size-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Search className="size-4" />
            </button>
            {!collapsed && (
              <button
                type="button"
                aria-label="Sort projects"
                className="flex size-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <ArrowDownUp className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* New project */}
        <button
          type="button"
          aria-label="New project"
          className={`mt-1 flex h-9 w-full items-center gap-2 rounded-xl border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-sm font-medium text-white backdrop-blur-[3.7px] transition-colors hover:bg-white/[0.08] ${
            collapsed ? "justify-center px-0" : "px-2"
          }`}
          style={{
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-white/15">
            <Plus className="size-3.5" />
          </span>
          {!collapsed && <span className="truncate">New project</span>}
        </button>
      </div>
    </aside>
  );
}

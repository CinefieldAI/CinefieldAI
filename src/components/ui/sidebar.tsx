"use client";

import * as React from "react";
import { ChevronDown, Home, Grid3x3, Heart, Link2, Paperclip } from "lucide-react";

interface SidebarContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SidebarContext = React.createContext<SidebarContextType | undefined>(undefined);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}

interface SidebarProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SidebarProvider({ children, defaultOpen = true }: SidebarProviderProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();

  return (
    <aside
      className="fixed left-2 top-[72px] z-30 hidden h-[calc(100vh-88px)] flex-col gap-2 overflow-hidden rounded-[1.25rem] border border-white/[0.04] bg-[#18191C] p-2 md:flex transition-all duration-300"
      style={{ width: open ? 231 : 52 }}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({ children }: { children: React.ReactNode }) {
  const { open, setOpen } = useSidebar();

  return (
    <div className="flex h-11 items-center justify-between px-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="size-7 shrink-0 rounded-lg bg-gradient-to-br from-lime-300 to-green-600 flex items-center justify-center text-sm font-bold text-black">
          🎬
        </div>
        {open && <span className="truncate text-sm font-semibold text-white">Marketing Studio</span>}
      </div>
      {open && (
        <button
          onClick={() => setOpen(false)}
          className="flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ChevronDown className="size-4" />
        </button>
      )}
    </div>
  );
}

export function SidebarContent({ children }: { children: React.ReactNode }) {
  return <nav className="flex flex-col gap-0.5">{children}</nav>;
}

interface SidebarMenuItemProps {
  icon: React.ReactNode;
  label: string;
  gradient: string;
  active?: boolean;
  onClick?: () => void;
}

export function SidebarMenuItem({ icon, label, gradient, active, onClick }: SidebarMenuItemProps) {
  const { open } = useSidebar();

  return (
    <button
      onClick={onClick}
      className={`flex h-9 items-center gap-3 rounded-xl text-sm font-medium text-white transition-colors hover:bg-white/5 ${
        active ? "bg-white/5" : ""
      } ${open ? "pl-[11px] pr-1.5" : "justify-center px-0"}`}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: gradient,
          boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.45)",
        }}
      >
        {icon}
      </span>
      {open && <span className="truncate">{label}</span>}
    </button>
  );
}

export function SidebarFooter({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();

  return (
    <div className="mt-1 border-t border-white/[0.06] pt-2">
      <div className="flex items-center justify-between px-1.5 pb-1">
        {open && <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Tools</span>}
      </div>
      {children}
    </div>
  );
}

interface SidebarMenuButtonProps {
  icon: React.ReactNode;
  label: string;
}

export function SidebarMenuButton({ icon, label }: SidebarMenuButtonProps) {
  const { open } = useSidebar();

  return (
    <button
      className={`mt-1 flex h-9 w-full items-center gap-2 rounded-xl border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-sm font-medium text-white backdrop-blur-[3.7px] transition-colors hover:bg-white/[0.08] ${
        open ? "px-2" : "justify-center px-0"
      }`}
      style={{
        boxShadow: "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-white/15">{icon}</span>
      {open && <span className="truncate">{label}</span>}
    </button>
  );
}

export function SidebarTrigger() {
  const { open, setOpen } = useSidebar();

  if (open) return null;

  return (
    <button
      onClick={() => setOpen(true)}
      className="mx-auto flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
    >
      <ChevronDown className="size-4 rotate-90" />
    </button>
  );
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col">{children}</div>;
}

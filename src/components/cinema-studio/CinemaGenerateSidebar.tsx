"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Search, ArrowDownUp, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const COLLAPSED_WIDTH = 52;
const SNAP_COLLAPSE_THRESHOLD = 180;
const MAX_EXPANDED_WIDTH_FALLBACK = 480;
const DEFAULT_EXPANDED_WIDTH = 320;

/** Caps drag-expansion at the left edge of the "u" in the navbar's "Audio"
 *  link, so the sidebar can never grow wide enough to cover it. Measured via
 *  a DOM Range on the actual text node — exact, no font-metric guessing. */
function measureAudioULimit(): number | null {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(document.querySelectorAll("header button, header a"));
  const audioEl = candidates.find((el) => el.textContent?.trim() === "Audio");
  if (!audioEl) return null;
  const walker = document.createTreeWalker(audioEl, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent?.includes("Audio")) {
      textNode = node;
      break;
    }
  }
  if (!textNode) return null;
  const idx = textNode.textContent!.indexOf("Audio");
  try {
    const range = document.createRange();
    range.setStart(textNode, idx + 1);
    range.setEnd(textNode, idx + 2);
    const rect = range.getBoundingClientRect();
    return rect.left > 0 ? rect.left : null;
  } catch {
    return null;
  }
}

/** Sidebar-panel toggle icon — exact glyph given by the reference; the
 *  vertical divider line sits on the left (collapse) or right (expand) side
 *  of the box to hint which way the panel will move. */
function PanelToggleIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="size-4">
      <path
        d="M1.83333 3.83333C1.83333 3.46514 2.13181 3.16667 2.5 3.16667H13.5C13.8682 3.16667 14.1667 3.46515 14.1667 3.83333V12.1667C14.1667 12.5349 13.8682 12.8333 13.5 12.8333H2.5C2.13181 12.8333 1.83333 12.5349 1.83333 12.1667V3.83333Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d={side === "left" ? "M4.16667 5.5V10.5" : "M11.8333 5.5V10.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 3D-metallic gradient icon badge — matches the exact treatment used across
 *  the Marketing Studio sidebar's nav icons (base gradient + overlay blend +
 *  hard-light blend + hairline border), so both sidebars share one visual
 *  language even though they are fully independent components. */
function NavIconBadge({ gradient, children }: { gradient: string; children: ReactNode }) {
  return (
    <span aria-hidden="true" className="relative block size-6 shrink-0 overflow-visible">
      <span
        className="absolute inset-0 overflow-hidden rounded-lg shadow-[0_4px_2px_0_rgba(0,0,0,0.08),inset_0_2px_4px_0_rgba(255,255,255,0.24)]"
        style={{ background: gradient }}
      />
      <span className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,0.2)_100%)] mix-blend-overlay" />
      <span className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(0deg,rgba(0,0,0,0)_0%,rgba(255,255,255,0.32)_100%)] mix-blend-hard-light" />
      <span className="pointer-events-none absolute inset-0 rounded-lg border border-[rgba(197,197,197,0.24)]" />
      <span className="absolute inset-0 flex items-center justify-center text-[rgba(255,255,255,0.88)]">
        {children}
      </span>
    </span>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.83115 1.26572C9.34763 0.87015 8.65237 0.870143 8.16885 1.26572L2.73137 5.71459C2.4267 5.96387 2.25 6.33674 2.25 6.7304V14.4375C2.25 15.1624 2.83763 15.75 3.5625 15.75H14.4375C15.1624 15.75 15.75 15.1624 15.75 14.4375V6.7304C15.75 6.33674 15.5733 5.96387 15.2687 5.71459L9.83115 1.26572Z"
        fill="currentColor"
      />
      <path
        d="M8.48535 1.65263C8.7847 1.40774 9.2153 1.40773 9.51465 1.65263L14.9521 6.10185C15.1406 6.25617 15.25 6.48716 15.25 6.73076V14.4378C15.2498 14.8864 14.8861 15.2503 14.4375 15.2503H3.5625C3.11386 15.2503 2.75016 14.8864 2.75 14.4378V6.73076L2.75488 6.63994C2.77834 6.4304 2.8829 6.23691 3.04785 6.10185L8.48535 1.65263Z"
        stroke="rgba(255,255,255,0.5)"
        style={{ mixBlendMode: "overlay" }}
      />
    </svg>
  );
}

function ElementsIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.04953 8.49609C5.33684 6.45175 7.07651 4.77754 9.15527 5.06961C9.79817 5.15997 10.3581 5.42203 10.8164 5.80162C11.0112 5.48068 11.3858 5.291 11.7807 5.34835C12.3076 5.425 12.6733 5.91377 12.5968 6.44071L12.1988 9.17536C12.0771 10.0356 12.7007 10.8231 13.5661 10.9018C14.0734 10.9478 14.3642 10.7658 14.5731 10.4787C14.8184 10.1414 14.9736 9.60566 14.9736 8.99958C14.9734 5.70086 12.2983 3.02679 8.99958 3.02679C5.701 3.02701 3.02701 5.701 3.02679 8.99958C3.02679 12.2983 5.70086 14.9734 8.99958 14.9736C10.1546 14.9736 11.2312 14.6467 12.1436 14.0809C12.5961 13.8004 13.1901 13.9398 13.4707 14.3923C13.7511 14.8448 13.6118 15.4388 13.1593 15.7194C11.9506 16.4691 10.524 16.9022 8.99958 16.9022C4.63574 16.902 1.09821 13.3635 1.09821 8.99958C1.09844 4.63588 4.63588 1.09844 8.99958 1.09821C13.3635 1.09821 16.902 4.63574 16.9022 8.99958C16.9022 9.8782 16.6876 10.8522 16.1338 11.6137C15.5436 12.4252 14.6051 12.9318 13.3916 12.8216C12.4921 12.7398 11.7096 12.3194 11.1504 11.7016C10.3884 12.5745 9.28139 13.0936 8.05162 12.9208C5.97319 12.6285 4.76251 10.5401 5.04953 8.49609ZM8.88658 6.97935C8.09425 6.86827 7.13326 7.52687 6.95926 8.76353C6.78541 10.0006 7.52782 10.8996 8.32031 11.011C9.11273 11.1224 10.0737 10.4627 10.2476 9.22559C10.4213 7.98871 9.67891 7.09071 8.88658 6.97935Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FavoritesIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M9 3.24586C9.14513 3.14047 9.32895 3.01957 9.54893 2.89915C10.1411 2.5751 11.0044 2.25 12.0833 2.25C13.1984 2.25 14.3122 2.69828 15.1441 3.58863C15.9785 4.48172 16.5 5.78636 16.5 7.45312C16.5 9.9402 14.7367 12.0185 13.0445 13.4211C12.1835 14.1348 11.3051 14.7037 10.6018 15.0957C10.2502 15.2917 9.9369 15.4466 9.68633 15.5543C9.56153 15.608 9.44603 15.6527 9.34523 15.6851C9.26333 15.7114 9.13155 15.75 9 15.75C8.86845 15.75 8.73667 15.7114 8.65477 15.6851C8.55397 15.6527 8.43847 15.608 8.31367 15.5543C8.0631 15.4466 7.74983 15.2917 7.39824 15.0957C6.69489 14.7037 5.81654 14.1348 4.95549 13.4211C3.26335 12.0185 1.5 9.9402 1.5 7.45312C1.5 5.78636 2.02146 4.48172 2.85592 3.58863C3.68781 2.69828 4.80156 2.25 5.91667 2.25C6.99564 2.25 7.85895 2.5751 8.45107 2.89915C8.67105 3.01957 8.85487 3.14047 9 3.24586Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9 1.25C10.8468 1.25 12.5426 1.89711 13.874 2.97559L14.2588 2.5918C14.5761 2.27453 15.0909 2.27458 15.4082 2.5918C15.7254 2.90909 15.7254 3.42392 15.4082 3.74121L15.0234 4.125C16.1024 5.45658 16.75 7.15268 16.75 9C16.75 13.2802 13.2802 16.75 9 16.75C7.15268 16.75 5.45658 16.1024 4.125 15.0234L3.74121 15.4082C3.42391 15.7255 2.9091 15.7255 2.5918 15.4082C2.27455 15.0909 2.27452 14.5761 2.5918 14.2588L2.97559 13.874C1.89711 12.5426 1.25 10.8468 1.25 9C1.25 4.71979 4.71979 1.25 9 1.25ZM5.28125 13.8662C6.31247 14.6555 7.60095 15.125 9 15.125C9.8915 15.125 10.7364 14.931 11.5 14.5889C11.3154 14.5131 11.1282 14.4279 10.9404 14.334C9.84076 13.7841 8.59709 12.8912 7.38281 11.7646L5.28125 13.8662ZM8.53223 10.6162C9.64496 11.6421 10.7472 12.4209 11.667 12.8809C12.212 13.1533 12.6513 13.2929 12.9648 13.3301C13.1985 13.3578 13.2887 13.3214 13.3115 13.3096C13.3242 13.2836 13.3569 13.1917 13.3301 12.9648C13.2929 12.6513 13.1534 12.2119 12.8809 11.667C12.421 10.7472 11.6421 9.64501 10.6162 8.53223L8.53223 10.6162ZM3.41016 6.49805C3.06768 7.26198 2.875 8.10799 2.875 9C2.875 10.3986 3.34297 11.6877 4.13184 12.7188L6.23438 10.6162C5.10827 9.40225 4.2157 8.15896 3.66602 7.05957C3.57176 6.87106 3.48615 6.68337 3.41016 6.49805ZM11.7656 7.38281C12.892 8.59703 13.7852 9.84084 14.335 10.9404C14.4287 11.128 14.5142 11.3146 14.5898 11.499C14.9316 10.7357 15.125 9.89102 15.125 9C15.125 7.60095 14.6555 6.31247 13.8662 5.28125L11.7656 7.38281ZM5.03613 4.66992C4.80396 4.64241 4.71202 4.67646 4.68848 4.68848C4.67635 4.71242 4.64258 4.80407 4.66992 5.03516C4.70708 5.34867 4.84664 5.78801 5.11914 6.33301C5.57894 7.25261 6.35816 8.35418 7.38379 9.4668L9.4668 7.38281C8.35435 6.3574 7.25246 5.57887 6.33301 5.11914C5.78831 4.8468 5.3496 4.70716 5.03613 4.66992ZM9 2.875C8.10878 2.875 7.26342 3.06726 6.5 3.40918C6.6849 3.48504 6.87149 3.57198 7.05957 3.66602C8.15898 4.2157 9.4022 5.10828 10.6162 6.23438L12.7188 4.13184C11.6877 3.34297 10.3986 2.875 9 2.875Z"
        fill="currentColor"
      />
    </svg>
  );
}

function AcademyIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(1 1)">
        <path
          d="M8.21147 2.04696C8.0774 1.98434 7.9226 1.98434 7.78853 2.04696L0.288557 5.55134C0.11252 5.63359 0 5.81049 0 6.00499C0 6.1995 0.11252 6.3764 0.288557 6.45865L7.78853 9.963C7.9226 10.0257 8.0774 10.0257 8.21147 9.963L15 6.79107V10.1769C15 10.4533 15.2239 10.6775 15.5 10.6775C15.7761 10.6775 16 10.4533 16 10.1769V6.00499C16 5.81049 15.8875 5.63359 15.7115 5.55134L8.21147 2.04696Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3 8.49475V10.8362C3 11.2719 3.24227 11.6715 3.62843 11.8725L7.46173 13.8683C7.79913 14.044 8.2008 14.044 8.5382 13.8683L12.3715 11.8725C12.7577 11.6715 13 11.2719 13 10.8362V8.49475L8.30507 10.9141C8.1136 11.0128 7.8864 11.0128 7.69493 10.9141L3 8.49475Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

interface NavItem {
  id: string;
  label: string;
  icon: () => ReactNode;
  gradient: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: HomeIcon, gradient: "linear-gradient(135deg,#222221 3.87%,#3B3C3A 93.45%)" },
  { id: "my-elements", label: "My elements", icon: ElementsIcon, gradient: "linear-gradient(135deg,#4188BE 3.87%,#0E2772 93.45%)" },
  { id: "my-favorites", label: "My favorites", icon: FavoritesIcon, gradient: "linear-gradient(135deg,#E251B4 3.87%,#8D1237 93.45%)" },
  { id: "community", label: "Community", icon: CommunityIcon, gradient: "linear-gradient(135deg,#A5A5A5 3.87%,#3D3D3D 93.45%)" },
  { id: "academy", label: "Academy", icon: AcademyIcon, gradient: "linear-gradient(-45deg,#0E3A15 0%,#2EB844 100%)" },
];

interface CinemaGenerateSidebarProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  activeView?: string;
  onViewChange?: (view: string) => void;
  /** Fires whenever the rendered width changes (collapse toggle or drag-resize)
   *  so the page can keep its main-content offset in sync. */
  onWidthChange?: (width: number, isDragging: boolean) => void;
}

export default function CinemaGenerateSidebar({
  isCollapsed: externalIsCollapsed,
  onToggleCollapse: externalOnToggleCollapse,
  activeView = "home",
  onViewChange,
  onWidthChange,
}: CinemaGenerateSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = externalIsCollapsed ?? internalCollapsed;
  const handleToggle = externalOnToggleCollapse ?? (() => setInternalCollapsed(!internalCollapsed));

  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Drag-to-resize state — the same handle both collapses (drag left past the
  // snap threshold) and re-expands (drag right from collapsed) the sidebar,
  // independent of the dedicated collapse/expand button above.
  const [expandedWidth, setExpandedWidth] = useState(DEFAULT_EXPANDED_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStartRef = useRef({ x: 0, width: DEFAULT_EXPANDED_WIDTH });
  const dragMaxRef = useRef(MAX_EXPANDED_WIDTH_FALLBACK);
  // Mirrors `dragWidth` synchronously so mouseup can read the latest value
  // without a stale closure — and, critically, without reaching into the
  // setDragWidth updater to do it (calling a parent's setState from inside
  // another component's state-updater callback is what broke this before:
  // React/StrictMode invokes updaters twice, so the collapse toggle fired
  // twice and canceled itself out).
  const dragWidthRef = useRef<number | null>(null);

  // Refs so the drag listeners (attached once per drag) always see the
  // latest collapsed state / toggle callback without needing to restart
  // mid-drag if the parent re-renders.
  const isCollapsedRef = useRef(isCollapsed);
  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);
  const handleToggleRef = useRef(handleToggle);
  useEffect(() => {
    handleToggleRef.current = handleToggle;
  });

  // The sidebar's own rendered width — follows the live drag in real time.
  const width = dragWidth ?? (isCollapsed ? COLLAPSED_WIDTH : expandedWidth);
  // Report the live width, drag included, so the content panel moves in the
  // same frame as the sidebar. Reporting only the resting width used to leave
  // the page background exposed between the two for the length of a drag.
  // `isDragging` rides along so the consumer can drop its transition while the
  // pointer is down and not lag a frame behind.
  useEffect(() => {
    onWidthChange?.(width, isDragging);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, isDragging]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartRef.current.x;
      const next = Math.min(
        dragMaxRef.current,
        Math.max(COLLAPSED_WIDTH, dragStartRef.current.width + delta),
      );
      dragWidthRef.current = next;
      setDragWidth(next);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      const finalWidth = dragWidthRef.current;
      dragWidthRef.current = null;
      setDragWidth(null);
      if (finalWidth == null) return;
      const shouldCollapse = finalWidth < SNAP_COLLAPSE_THRESHOLD;
      if (shouldCollapse !== isCollapsedRef.current) handleToggleRef.current();
      if (!shouldCollapse) setExpandedWidth(finalWidth);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragMaxRef.current = measureAudioULimit() ?? MAX_EXPANDED_WIDTH_FALLBACK;
    dragStartRef.current = {
      x: e.clientX,
      width: isCollapsed ? COLLAPSED_WIDTH : expandedWidth,
    };
    setIsDragging(true);
  };

  return (
    <aside
      role="navigation"
      aria-label="Cinema Studio Sidebar"
      className={cn(
        "fixed left-0 top-14 z-40 hidden h-[calc(100vh-72px)] flex-col overflow-hidden rounded-[18px] border border-white/[0.04] bg-[#18191C] md:flex",
        !isDragging && "transition-[width] duration-300 ease-out"
      )}
      style={{ width }}
    >
      <div className="relative flex h-full flex-col overflow-hidden">
        {/* Collapse toggle — small icon overlay, top-right of the header row.
            Only shown expanded; the collapsed state gets its own big button below. */}
        {!isCollapsed && (
          <div className="absolute right-2.5 top-1 z-30 flex h-11 items-center">
            <button
              type="button"
              onClick={handleToggle}
              aria-label="Collapse sidebar"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <PanelToggleIcon side="left" />
            </button>
          </div>
        )}

        <div className="flex h-full flex-col gap-2 p-2">
          {/* TOP CARD: SPACE SWITCHER HEADER WITH SITE LOGO */}
          {isCollapsed ? (
            <div className="flex h-11 w-full shrink-0 items-center justify-center">
              <button
                type="button"
                onClick={handleToggle}
                aria-label="Expand sidebar"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/50 shadow-[0_2px_8px_0_rgba(0,0,0,0.06)] transition-colors hover:bg-white/10 hover:text-white"
              >
                <PanelToggleIcon side="right" />
              </button>
            </div>
          ) : (
            <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#141517] px-2 shadow-[0_2px_8px_0_rgba(0,0,0,0.12)]">
              <img
                src="/cinefield-logo.png"
                alt="Cinema Studio"
                className="size-6 shrink-0 rounded-md object-cover"
              />
              <span className="truncate text-sm font-semibold text-white/90">Cinema Studio</span>
            </div>
          )}

          {/* NAVIGATION LINKS */}
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onViewChange?.(item.id)}
                  aria-label={item.label}
                  className={cn(
                    "group flex h-9 w-full items-center gap-2.5 rounded-xl px-1.5 text-left text-sm font-medium text-white/80 transition-colors hover:bg-white/5",
                    isActive && "bg-white/10 text-white",
                    isCollapsed && "justify-center px-0"
                  )}
                >
                  <NavIconBadge gradient={item.gradient}>
                    <Icon />
                  </NavIconBadge>
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* PROJECTS SECTION */}
          <div className="mt-1 flex min-h-0 flex-1 flex-col border-t border-white/[0.06] pt-2">
            <div className="flex h-8 shrink-0 items-center justify-between px-1.5">
              {!isCollapsed && (
                <span className="text-xs font-medium text-white/50">Projects</span>
              )}
              <div className={cn("flex items-center gap-0.5", isCollapsed && "mx-auto")}>
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(!isSearchOpen)}
                  aria-label="Search projects"
                  className="flex size-6 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Search className="size-4" />
                </button>
                {!isCollapsed && (
                  <button
                    type="button"
                    aria-label="Sort projects"
                    className="flex size-6 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <ArrowDownUp className="size-4" />
                  </button>
                )}
              </div>
            </div>

            {isSearchOpen && !isCollapsed && (
              <div className="shrink-0 px-1.5 pb-1.5">
                <div
                  className="flex h-9 w-full items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2 shadow-[0_2px_2px_rgba(0,0,0,0.08),inset_0_-6px_12px_rgba(255,255,255,0.04)]"
                >
                  <Search className="size-4 shrink-0 text-white/50" />
                  <input
                    type="text"
                    placeholder="Find project.."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
                  />
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1" />

            {/* NEW PROJECT BUTTON */}
            <div className="shrink-0 px-1.5 pb-1.5">
              <button
                type="button"
                aria-label="New project"
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-xl border border-[rgba(197,197,197,0.3)] bg-white/[0.08] text-sm font-medium text-white transition-colors hover:bg-white/[0.14]",
                  "shadow-[inset_0_-0.3px_5.36px_rgba(185,185,185,0.35),0_5.06px_5.65px_rgba(0,0,0,0.1),0_20.53px_10.27px_rgba(0,0,0,0.09),0_46.42px_13.99px_rgba(0,0,0,0.05)]",
                  isCollapsed ? "justify-center px-0" : "px-2"
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md">
                  <Plus className="size-4" />
                </span>
                {!isCollapsed && <span className="truncate">New project</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Resize-handle — drag left/right to resize. Works from either state:
          drag left past the snap threshold collapses the sidebar, drag right
          from collapsed re-expands it. Independent of the collapse/expand
          button above; hairline brightens on hover with a chevron affordance,
          matching the reference sidebar. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={handleResizeMouseDown}
        className="group/resize absolute right-0 top-0 z-50 h-full w-3 translate-x-1/2 cursor-col-resize touch-none"
      >
        <div
          className={cn(
            "absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-[linear-gradient(to_bottom,transparent_0%,rgba(255,255,255,0.2)_18%,rgba(255,255,255,0.2)_82%,transparent_100%)] transition-opacity duration-150",
            isDragging ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-px rounded-sm bg-[#18191C] px-px text-white/70 transition-opacity duration-150",
            isDragging ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100"
          )}
        >
          <ChevronLeft className="size-2.5" />
          <ChevronRight className="size-2.5" />
        </div>
      </div>
    </aside>
  );
}

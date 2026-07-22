"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Film,
  ImageIcon,
  Menu,
  Music2,
  Search,
  X,
  Rocket,
  FolderClosed,
} from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import ImageMegaDropdown from "./ImageMegaDropdown";
import VideoMegaDropdown from "./VideoMegaDropdown";
import AudioMegaDropdown from "./AudioMegaDropdown";
import CompactDropdown from "./CompactDropdown";
import type { ImageFeatureKey } from "./imageDropdownData";
import type { ActiveView, PanelKey } from "./panelData";
import { AUDIO_FEATURES, AUDIO_MODELS, type AudioMode } from "./audioMenuData";
import {
  COLLAB_ITEMS,
  MCP_CLI_ITEMS,
  PLUGINS_ITEMS,
  SUPERCOMPUTER_ITEMS,
  type CompactItem,
} from "./compactMenuData";

interface NavLink {
  label: string;
  href: string;
}

const LINKS_LEFT: NavLink[] = [{ label: "Explore", href: "/" }];

const DROPDOWN_LINKS: { label: string; items: CompactItem[] }[] = [
  { label: "Supercomputer", items: SUPERCOMPUTER_ITEMS },
  { label: "MCP & CLI", items: MCP_CLI_ITEMS },
  { label: "Collab", items: COLLAB_ITEMS },
  { label: "Plugins", items: PLUGINS_ITEMS },
];

const LINKS_RIGHT: NavLink[] = [
  { label: "Marketing Studio", href: "/marketing-studio/product" },
  { label: "Cinema Studio", href: "/generate" },
  { label: "Originals", href: "/original-series" },
  { label: "Canvas", href: "/canvas" },
  { label: "AI Influencer", href: "/ai-influencer-studio" },
  { label: "Apps", href: "/apps" },
];

function CinefieldLogo() {
  return (
    <Link
      href="/"
      aria-label="CINEFIELD"
      className="flex shrink-0 items-center"
    >
      <Image
        src="/10d90591-1bbe-4cf6-9753-aa2faa93afbf.png"
        alt="CINEFIELD"
        width={36}
        height={36}
        priority
        className="h-9 w-9 rounded-xl object-cover drop-shadow-[0_0_8px_rgba(0,229,255,0.5)]"
      />
    </Link>
  );
}

function MicroDotCluster() {
  return (
    <span className="flex items-center gap-0.5">
      <span className="h-1 w-1 animate-pulse rounded-full bg-magenta-400" />
      <span
        className="h-1 w-1 animate-pulse rounded-full bg-magenta-400"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="h-1 w-1 animate-pulse rounded-full bg-magenta-400"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

function SearchButton() {
  return (
    <button
      type="button"
      className="hidden items-center gap-2 rounded-[10px] bg-white/5 px-2.5 h-9 text-neutral-400 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-neutral-200 sm:flex"
    >
      <Search className="h-4 w-4" />
      <span className="text-sm">Search</span>
      <span className="ml-1 flex items-center gap-0.5">
        <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          Ctrl
        </kbd>
        <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          K
        </kbd>
      </span>
    </button>
  );
}

function PricingUpgradeLink() {
  return (
    <a
      href="/pricing"
      className="relative hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 h-9 text-sm font-medium text-white transition-colors hover:bg-white/10 sm:flex"
    >
      <Rocket className="h-4 w-4 text-magenta-400" />
      Pricing
      <span className="absolute -top-2 -right-3 rounded-full bg-[radial-gradient(39.71%_136.54%_at_51.64%_117.31%,#33eaff_0%,#00b8cc_100%)] px-2 py-0.5 text-[10px] font-bold text-white shadow-lg shadow-magenta-500/30">
        30% OFF
      </span>
    </a>
  );
}

function AssetsButton() {
  return (
    <a
      href="/asset/all"
      className="relative hidden items-center gap-2 overflow-hidden rounded-[10px] h-9 px-3 text-sm text-neutral-300 backdrop-blur-md transition-colors hover:text-white md:flex"
    >
      <span
        className="absolute inset-0 rounded-[10px]"
        style={{ background: "rgba(255,255,255,0.05)" }}
      />
      <FolderClosed className="relative z-10 h-4 w-4" />
      <span className="relative z-10">Assets</span>
    </a>
  );
}

function ProfileAvatar() {
  const progress = 68;
  const circumference = 100;
  return (
    <button
      type="button"
      aria-label="Workspace profile"
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle
          cx={18}
          cy={18}
          r={16}
          fill="none"
          strokeWidth={2}
          className="stroke-white/10"
        />
        <circle
          cx={18}
          cy={18}
          r={16}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          pathLength={circumference}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className="stroke-current text-magenta-500 transition-all duration-500"
        />
      </svg>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-xs font-semibold text-white">
        C
      </span>
    </button>
  );
}

interface NavbarProps {
  activePanel: PanelKey | null;
  onOpenImagePanel: () => void;
  onOpenVideoPanel: () => void;
  onOpenAudioPanel: () => void;
  onSetView: (view: ActiveView) => void;
  /**
   * Shared Audio mode/model — single source of truth also read by the
   * bottom rotary selector on /audio/create. Optional so pages that don't
   * surface the Audio workspace (Marketing Studio, Cinema Studio) can keep
   * rendering Navbar without wiring this up.
   */
  audioMode?: AudioMode;
  onAudioModeChange?: (mode: AudioMode) => void;
  audioModelIndex?: number;
  onAudioModelIndexChange?: (index: number) => void;
}

export default function Navbar({
  activePanel,
  onOpenImagePanel,
  onOpenVideoPanel,
  onOpenAudioPanel,
  onSetView,
  audioMode,
  onAudioModeChange,
  audioModelIndex,
  onAudioModelIndexChange,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleFeatureSelect = (key: ImageFeatureKey) => {
    if (key === "create") {
      onSetView("createImage");
    } else if (key === "canvas") {
      onSetView("canvas");
    } else if (key === "moodboard") {
      onSetView("moodboard");
    } else if (key === "character") {
      onSetView("character");
    } else {
      onOpenImagePanel();
    }
  };

  const handleModelSelect = () => {
    onOpenImagePanel();
  };

  const handleVideoFeatureSelect = (title: string) => {
    if (title === "Canvas") {
      onSetView("canvas");
    } else {
      onOpenVideoPanel();
    }
  };

  // Audio: mega-dropdown rows carry only a title, so map it back to the
  // shared AudioMode/model-index state before opening the workspace.
  const activeAudioFeatureTitle = AUDIO_FEATURES.find(
    (f) => f.mode === audioMode,
  )?.title;
  const activeAudioModelTitle = AUDIO_MODELS[audioModelIndex ?? 0]?.title;

  const handleAudioFeatureSelect = (title: string) => {
    const feature = AUDIO_FEATURES.find((f) => f.title === title);
    if (feature) onAudioModeChange?.(feature.mode);
    onOpenAudioPanel();
  };

  const handleAudioModelSelect = (title: string) => {
    const index = AUDIO_MODELS.findIndex((m) => m.title === title);
    if (index >= 0) onAudioModelIndexChange?.(index);
    onOpenAudioPanel();
  };

  return (
    <header className="sticky top-0 z-51 grid h-16 w-full grid-cols-[1fr_auto] items-center bg-black/90 pr-4 backdrop-blur-md md:grid-cols-[auto_1fr_auto]">
      {/* Column 1: logo */}
      <div className="flex items-center gap-2 pl-4 md:pl-6">
        <CinefieldLogo />
      </div>

      {/* Column 2: nav menu (md+) */}
      <div className="hidden min-w-0 items-center justify-center md:flex">
        <NavigationMenu className="max-w-none justify-start">
          <NavigationMenuList className="flex-nowrap gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
            {LINKS_LEFT.map((link) => (
              <NavigationMenuItem key={link.label}>
                <NavigationMenuLink
                  href={link.href}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}

            {/* Image: mega dropdown trigger */}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={
                  activePanel === "image" ? "bg-white/10 text-white" : undefined
                }
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Image
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ImageMegaDropdown
                  onFeatureSelect={handleFeatureSelect}
                  onModelSelect={handleModelSelect}
                />
              </NavigationMenuContent>
            </NavigationMenuItem>

            {/* Video: mega dropdown trigger */}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={
                  activePanel === "video" ? "bg-white/10 text-white" : undefined
                }
              >
                <Film className="h-3.5 w-3.5" />
                Video
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <VideoMegaDropdown
                  onFeatureSelect={handleVideoFeatureSelect}
                  onModelSelect={onOpenVideoPanel}
                />
              </NavigationMenuContent>
            </NavigationMenuItem>

            {/* Audio: mega dropdown trigger */}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={
                  activePanel === "audio" ? "bg-white/10 text-white" : undefined
                }
              >
                <Music2 className="h-3.5 w-3.5" />
                Audio
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <AudioMegaDropdown
                  onFeatureSelect={handleAudioFeatureSelect}
                  onModelSelect={handleAudioModelSelect}
                  activeFeatureTitle={activeAudioFeatureTitle}
                  activeModelTitle={activeAudioModelTitle}
                />
              </NavigationMenuContent>
            </NavigationMenuItem>

            {DROPDOWN_LINKS.map((link) => (
              <NavigationMenuItem key={link.label}>
                <NavigationMenuTrigger>
                  {link.label}
                  {link.label === "Supercomputer" && <MicroDotCluster />}
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <CompactDropdown items={link.items} />
                </NavigationMenuContent>
              </NavigationMenuItem>
            ))}

            {LINKS_RIGHT.map((link) => (
              <NavigationMenuItem key={link.label}>
                <NavigationMenuLink
                  href={link.href}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                  {link.label === "Supercomputer" && <MicroDotCluster />}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      </div>

      {/* Column 3: actions */}
      <div className="flex items-center justify-end gap-2.5">
        <SearchButton />
        <PricingUpgradeLink />
        <AssetsButton />
        <ProfileAvatar />

        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 hover:bg-white/5 md:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="col-span-2 border-t border-white/10 bg-black px-4 py-4 md:hidden">
          <div className="flex flex-wrap gap-2">
            {LINKS_LEFT.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
              >
                {link.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                onOpenImagePanel();
                setMobileOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Image
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenVideoPanel();
                setMobileOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
            >
              <Film className="h-3.5 w-3.5" />
              Video
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenAudioPanel();
                setMobileOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
            >
              <Music2 className="h-3.5 w-3.5" />
              Audio
            </button>
            {DROPDOWN_LINKS.map((link) => (
              <span
                key={link.label}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
              >
                {link.label}
              </span>
            ))}
            {LINKS_RIGHT.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

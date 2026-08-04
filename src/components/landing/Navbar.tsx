"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useAuthModal } from "@/context/AuthModalContext";
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
  MCP_CLI_ITEMS,
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
];

const LINKS_RIGHT: NavLink[] = [
  { label: "Marketing Studio", href: "/marketing-studio/product" },
  { label: "Cinema Studio", href: "/generate" },
  { label: "Shorts Studio", href: "/shorts-studio" },
  { label: "Explainer", href: "/explainer" },
];

function CinefieldLogo() {
  return (
    <Link
      href="/"
      aria-label="CINEFIELD"
      className="flex shrink-0 items-center"
    >
      <img
        src="/cinefield-logo.png"
        alt="CINEFIELD"
        className="h-9 w-9 rounded-xl object-cover drop-shadow-[0_0_8px_rgba(217,119,87,0.5)]"
      />
    </Link>
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
    </a>
  );
}

/**
 * Logged-out top-right action group: Pricing (routes to /pricing) →
 * separator → Login / Sign up. Login and Sign up currently just flip the
 * local `isAuthenticated` demo flag in Navbar (no real backend exists yet),
 * which reveals the previous authenticated controls (Search, Pricing pill,
 * Assets, avatar) below — see the "authenticated" branch in Navbar's render.
 */
function PricingAction() {
  return (
    <Link
      href="/pricing"
      title="View Higgsfield AI pricing plans and subscription options"
      className="relative hidden items-center gap-1.5 rounded-[10px] bg-white/5 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/10 active:bg-white/15 sm:flex"
    >
      <svg
        className="size-4"
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.56218 3.52331C6.89119 3.18855 7.34089 3 7.81027 3H16.186C16.6554 3 17.1051 3.18855 17.4341 3.52331L22.5881 8.76722C23.2614 9.45231 23.2567 10.5521 22.5774 11.2313L13.2356 20.5732C12.5521 21.2566 11.4441 21.2566 10.7607 20.5732L1.41881 11.2313C0.73957 10.5521 0.734815 9.45231 1.40816 8.76722L6.56218 3.52331ZM9.02845 7.21967C9.32135 7.51256 9.32135 7.98744 9.02845 8.28033L7.30878 10L9.02845 11.7197C9.32135 12.0126 9.32135 12.4874 9.02845 12.7803C8.73556 13.0732 8.26069 13.0732 7.96779 12.7803L5.71779 10.5303C5.4249 10.2374 5.4249 9.76256 5.71779 9.46967L7.96779 7.21967C8.26069 6.92678 8.73556 6.92678 9.02845 7.21967Z"
          fill="currentColor"
        />
      </svg>
      Pricing
    </Link>
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
  /**
   * A specific model was clicked in the Image mega-dropdown — routes to the
   * full Create Image workspace with that model preselected. Optional so
   * pages without the workspace (Cinema Studio, Marketing Studio, etc.) can
   * render Navbar unchanged; when omitted, model clicks fall back to
   * onOpenImagePanel like before.
   */
  onOpenImageModel?: (modelName: string) => void;
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
  onOpenImageModel,
  onOpenVideoPanel,
  onOpenAudioPanel,
  onSetView,
  audioMode,
  onAudioModeChange,
  audioModelIndex,
  onAudioModelIndexChange,
}: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const { openModal } = useAuthModal();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openNavItem, setOpenNavItem] = useState("");

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

  // Two of the thirteen models in the dropdown aren't prompt-driven image
  // generators — Popcorn is a storyboard tool, Topaz is an upscaler — so
  // they don't have a Create Image workspace destination yet and keep
  // falling back to the generic side panel.
  const IMAGE_MODELS_WITHOUT_WORKSPACE = new Set(["Higgsfield Popcorn", "Topaz"]);
  // The dropdown's display names match the Create Image workspace's model
  // list 1:1 except for these two casing/naming differences.
  const IMAGE_DROPDOWN_TO_WORKSPACE_MODEL: Record<string, string> = {
    "Seedream 5.0 lite": "Seedream 5.0 Lite",
    "FLUX.2": "FLUX.2 Pro",
  };

  const handleModelSelect = (name: string) => {
    if (!onOpenImageModel || IMAGE_MODELS_WITHOUT_WORKSPACE.has(name)) {
      onOpenImagePanel();
      return;
    }
    onOpenImageModel(IMAGE_DROPDOWN_TO_WORKSPACE_MODEL[name] ?? name);
  };

  const handleVideoFeatureSelect = (title: string) => {
    if (title === "Create Video") {
      setOpenNavItem("");
      router.push("/video/create");
    } else if (title === "Canvas") {
      onSetView("canvas");
    } else {
      onOpenVideoPanel();
    }
  };

  const handleVideoModelSelect = (name: string) => {
    setOpenNavItem("");
    router.push(`/video/create?model=${encodeURIComponent(name)}`);
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
    setOpenNavItem("");
  };

  const handleAudioModelSelect = (title: string) => {
    const index = AUDIO_MODELS.findIndex((m) => m.title === title);
    if (index >= 0) onAudioModelIndexChange?.(index);
    // A model only lives in Voiceover mode, so picking one from the top menu
    // also snaps the feature to Voiceover — otherwise (in Change Voice /
    // Translate) the composer shows no model controls and nothing visibly
    // changes. Mirrors how selecting a Feature updates the composer.
    onAudioModeChange?.("voiceover");
    onOpenAudioPanel();
    setOpenNavItem("");
  };

  return (
    <header
      className="sticky top-0 z-51 grid h-14 w-full grid-cols-[1fr_auto] items-center pr-4 md:grid-cols-[auto_1fr_auto]"
      style={{
        background: "rgba(35,38,42,0.75)",
        backdropFilter: "blur(40px)",
        WebkitBackdropFilter: "blur(40px)",
      }}
    >
      {/* Column 1: logo */}
      <div className="flex items-center gap-2 pl-4 md:pl-6">
        <CinefieldLogo />
      </div>

      {/* Column 2: nav menu (md+) */}
      <div className="hidden min-w-0 items-center justify-center md:flex">
        <NavigationMenu
          className="max-w-none justify-start"
          value={openNavItem}
          onValueChange={setOpenNavItem}
        >
          <NavigationMenuList className="flex-nowrap gap-1 overflow-x-auto px-2 [scrollbar-width:none]">
            {LINKS_LEFT.map((link) => (
              <NavigationMenuItem key={link.label}>
                <NavigationMenuLink
                  href={link.href}
                  className={
                    pathname === link.href ? "text-[#D97757]" : undefined
                  }
                >
                  {link.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}

            {/* Image: mega dropdown trigger */}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`text-[14px] ${
                  activePanel === "image"
                    ? "bg-white/10 text-[#D97757]"
                    : ""
                }`}
              >
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
                className={`text-[14px] ${
                  activePanel === "video" ||
                  pathname.startsWith("/video/")
                    ? "bg-white/10 text-[#D97757]"
                    : ""
                }`}
              >
                Video
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <VideoMegaDropdown
                  onFeatureSelect={handleVideoFeatureSelect}
                  onModelSelect={handleVideoModelSelect}
                />
              </NavigationMenuContent>
            </NavigationMenuItem>

            {/* Audio: mega dropdown trigger */}
            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`text-[14px] ${
                  activePanel === "audio" ||
                  pathname.startsWith("/audio/")
                    ? "bg-white/10 text-[#D97757]"
                    : ""
                }`}
              >
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
                <NavigationMenuTrigger
                  className={
                    link.label === "Supercomputer" &&
                    pathname.startsWith("/supercomputer")
                      ? "bg-white/10 text-[#D97757]"
                      : undefined
                  }
                >
                  {link.label}
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
                  className={
                    pathname === link.href ? "text-[#D97757]" : undefined
                  }
                >
                  {link.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      </div>

      {/* Column 3: actions */}
      <div className="flex items-center justify-end gap-2.5">
        {isSignedIn ? (
          <>
            <SearchButton />
            <PricingUpgradeLink />
            <AssetsButton />
            <UserButton
              appearance={{
                elements: {
                  userButtonAvatarBox: "h-9 w-9",
                  userButtonTrigger:
                    "rounded-full hover:opacity-80 transition-opacity",
                },
              }}
            />
          </>
        ) : (
          <div className="flex items-center">
            <PricingAction />
            <span
              aria-hidden="true"
              className="mx-2.5 hidden h-5 w-px bg-white/10 sm:block"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openModal("signin")}
                className="hidden h-9 items-center rounded-[10px] px-3.5 text-sm font-medium text-white transition-colors hover:bg-white/10 md:inline-flex"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => openModal("signup")}
                className="inline-flex h-9 items-center rounded-[10px] bg-white px-3.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 active:bg-white/80"
              >
                Sign up
              </button>
            </div>
          </div>
        )}

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
                setMobileOpen(false);
                router.push("/video/create");
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

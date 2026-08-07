"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Film, ImageIcon, Menu, Music2, X } from "lucide-react";
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
import NavbarActions from "./NavbarActions";
import type { ImageFeatureKey } from "./imageDropdownData";
import type { ActiveView, PanelKey } from "./panelData";
import { AUDIO_FEATURES, AUDIO_MODELS, type AudioMode } from "./audioMenuData";
import { MCP_CLI_ITEMS, type CompactItem } from "./compactMenuData";

interface NavLink {
  label: string;
  href: string;
}

const LINKS_LEFT: NavLink[] = [{ label: "Explore", href: "/" }];

/**
 * Supercomputer is a direct route, not a dropdown. It used to open a
 * CompactDropdown of placeholder capabilities; the /supercomputer page is
 * the real surface, so the trigger became a plain link — the same treatment
 * the Image and Audio menu entries already got.
 */
const SUPERCOMPUTER_LINK: NavLink = {
  label: "Supercomputer",
  href: "/supercomputer",
};

const DROPDOWN_LINKS: { label: string; items: CompactItem[] }[] = [
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openNavItem, setOpenNavItem] = useState("");

  const handleFeatureSelect = (key: ImageFeatureKey) => {
    if (key === "create") {
      goToWorkspace({ path: "/image", inPlace: () => onSetView("createImage") });
    } else if (key === "canvas") {
      goToWorkspace({ path: "/canvas", inPlace: () => onSetView("canvas") });
    } else if (key === "moodboard") {
      // No /moodboard route exists yet, so this stays an in-page view switch.
      onSetView("moodboard");
    } else if (key === "character") {
      // No /character route exists yet, so this stays an in-page view switch.
      onSetView("character");
    } else {
      onOpenImagePanel();
    }
  };

  // Two of the thirteen models in the dropdown aren't prompt-driven image
  // generators — Popcorn is a storyboard tool, Topaz is an upscaler — so
  // they don't have a Create Image workspace destination yet and keep
  // falling back to the generic side panel.
  const IMAGE_MODELS_WITHOUT_WORKSPACE = new Set(["🚫 Cinefield Popcorn", "Topaz"]);
  // The dropdown's display names match the Create Image workspace's model
  // list 1:1 except for these two casing/naming differences.
  const IMAGE_DROPDOWN_TO_WORKSPACE_MODEL: Record<string, string> = {
    "Seedream 5.0 lite": "Seedream 5.0 Lite",
    "FLUX.2": "FLUX.2 Pro",
  };

  /**
   * Picking a model always lands on /image with that model selected,
   * regardless of which page the navbar is currently rendered on.
   *
   * `onOpenImageModel` is supplied only by AppShell (so only on /, /image,
   * /audio/create, /canvas). It used to gate the whole destination: without
   * it the handler fell back to onOpenImagePanel(), which every other host
   * page defines differently — /video/create sent it to /generate, and
   * Cinema Studio, Marketing Studio, Shorts Studio and Explainer all pass a
   * noop, so the click silently did nothing there. The callback is now only
   * an in-place optimisation for when we are already on /image; the
   * destination itself no longer depends on the host page.
   */
  const handleModelSelect = (name: string) => {
    // Popcorn and Topaz have no Create Image workspace destination — they
    // keep the generic side-panel fallback they always had.
    if (IMAGE_MODELS_WITHOUT_WORKSPACE.has(name)) {
      onOpenImagePanel();
      return;
    }

    const workspaceModel = IMAGE_DROPDOWN_TO_WORKSPACE_MODEL[name] ?? name;
    setOpenNavItem("");

    if (pathname === "/image" && onOpenImageModel) {
      onOpenImageModel(workspaceModel);
      return;
    }

    router.push(`/image?model=${encodeURIComponent(workspaceModel)}`);
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

  /**
   * Opens a workspace at its own URL instead of only switching the in-page
   * view, so the address bar, browser back button, and shared links all
   * reflect what is on screen.
   *
   * Any selection (audio mode/model, image model) travels in the query string
   * because navigating remounts AppShell — without carrying it, the user's
   * choice would be silently reset to the defaults on arrival. When already
   * on the destination we switch in place instead, avoiding a redundant
   * navigation that would remount the workspace.
   *
   * Only used for views that have a real route. Views without one
   * (moodboard, character) keep switching in place.
   */
  const goToWorkspace = (params: { path: string; query?: string; inPlace: () => void }) => {
    setOpenNavItem("");

    if (pathname === params.path) {
      params.inPlace();
      return;
    }

    router.push(params.query ? `${params.path}?${params.query}` : params.path);
  };

  const goToAudioWorkspace = (params: { mode: AudioMode; modelIndex?: number }) => {
    const query = new URLSearchParams({ mode: params.mode });
    if (params.modelIndex !== undefined) query.set("model", String(params.modelIndex));
    goToWorkspace({
      path: "/audio/create",
      query: query.toString(),
      inPlace: onOpenAudioPanel,
    });
  };

  const handleAudioFeatureSelect = (title: string) => {
    const feature = AUDIO_FEATURES.find((f) => f.title === title);
    if (feature) onAudioModeChange?.(feature.mode);
    goToAudioWorkspace({ mode: feature?.mode ?? "voiceover" });
  };

  const handleAudioModelSelect = (title: string) => {
    const index = AUDIO_MODELS.findIndex((m) => m.title === title);
    if (index >= 0) onAudioModelIndexChange?.(index);
    // A model only lives in Voiceover mode, so picking one from the top menu
    // also snaps the feature to Voiceover — otherwise (in Change Voice /
    // Translate) the composer shows no model controls and nothing visibly
    // changes. Mirrors how selecting a Feature updates the composer.
    onAudioModeChange?.("voiceover");
    goToAudioWorkspace({ mode: "voiceover", modelIndex: index >= 0 ? index : 0 });
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

            {/* Supercomputer: direct route, keeps its original slot between
                Audio and MCP & CLI. */}
            <NavigationMenuItem>
              <NavigationMenuLink
                href={SUPERCOMPUTER_LINK.href}
                className={
                  pathname.startsWith(SUPERCOMPUTER_LINK.href)
                    ? "text-[#D97757]"
                    : undefined
                }
              >
                {SUPERCOMPUTER_LINK.label}
              </NavigationMenuLink>
            </NavigationMenuItem>

            {DROPDOWN_LINKS.map((link) => (
              <NavigationMenuItem key={link.label}>
                <NavigationMenuTrigger>{link.label}</NavigationMenuTrigger>
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

      {/* Column 3: actions — shared with /marketing-studio/product, which
          renders no navbar but still surfaces this group. */}
      <div className="flex items-center justify-end gap-2.5">
        <NavbarActions />

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
            {/* Supercomputer is a real link on mobile too — it used to render
                as an inert <span> alongside the other dropdown labels. */}
            <Link
              href={SUPERCOMPUTER_LINK.href}
              onClick={() => setMobileOpen(false)}
              className="rounded-full bg-white/5 px-3 py-1.5 text-sm text-zinc-200"
            >
              {SUPERCOMPUTER_LINK.label}
            </Link>
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

"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/landing/Navbar";
import { Plus, ChevronDown, Home, Grid3x3, Heart, Link2, Paperclip, Upload, Settings, X } from "lucide-react";
import { marketingStyleCards } from "@/data/marketingStyleCards";
import MediaAttachPanel, { UploadedMedia } from "@/components/marketing-studio/MediaAttachPanel";
import HookPanel, { HookItem } from "@/components/marketing-studio/HookPanel";
import SettingPanel, { SettingItem } from "@/components/marketing-studio/SettingPanel";
import OptionsDropdown from "@/components/marketing-studio/OptionsDropdown";
import ProductPanel from "@/components/marketing-studio/ProductPanel";
import SelectAvatarPanel from "@/components/marketing-studio/SelectAvatarPanel";
import AppPanel from "@/components/marketing-studio/AppPanel";
import YourAppModal from "@/components/marketing-studio/YourAppModal";

type Category = "All" | "TikTok" | "UGC" | "Commercial";
type ModeType = "UGC" | "Mobile" | "Settings";
type TargetType = "product" | "app";
type FloatingPanelType = "mediaAttach" | "hook" | "setting" | "product" | "app" | "avatar" | "options" | null;

interface StyleCard {
  id: string;
  title: string;
  description: string;
  category: string;
  badge: boolean;
  filename: string;
  localPath: string;
}

export default function MarketingStudioProduct() {
  const noop = () => {};
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewMode = searchParams.get("mode") || "product";

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarView, setActiveSidebarView] = useState<"home" | "allGenerations" | "favorites">("home");
  const [selectedTarget, setSelectedTarget] = useState<TargetType>("product");
  const [selectedMode, setSelectedMode] = useState<ModeType>("UGC");
  const [selectedStyle, setSelectedStyle] = useState<string>("ugc");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<Category>("All");
  const [prompt, setPrompt] = useState("");
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(false);
  const [panelSearchQuery, setPanelSearchQuery] = useState("");
  const [isMediaAttachPanelOpen, setIsMediaAttachPanelOpen] = useState(false);
  const [attachedProductMedia, setAttachedProductMedia] = useState<UploadedMedia[]>([]);
  const [activeFloatingPanel, setActiveFloatingPanel] = useState<FloatingPanelType>(null);
  const [selectedHook, setSelectedHook] = useState<HookItem | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingItem | null>(null);
  const [aspectRatio, setAspectRatio] = useState("21:9");
  const [quality, setQuality] = useState("1080p");
  const [duration, setDuration] = useState(15);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [productUrl, setProductUrl] = useState("");
  const [avatarFilter, setAvatarFilter] = useState<"all" | "pinned" | "myAvatars">("myAvatars");
  const [avatarGender, setAvatarGender] = useState<"male" | "female" | null>(null);
  const [avatarSearchQuery, setAvatarSearchQuery] = useState("");
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(null);
  const [showYourAppModal, setShowYourAppModal] = useState(false);
  const [hasApp, setHasApp] = useState(false);
  const [appUploadMode, setAppUploadMode] = useState<"web" | "mobile">("web");
  const [appScreenshot, setAppScreenshot] = useState<File | null>(null);
  const [appScreenshotPreview, setAppScreenshotPreview] = useState<string>("");
  const [appProductName, setAppProductName] = useState("");
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [appDescription, setAppDescription] = useState("");

  // Prompt bar docking system - USER CONTROLLED
  const [promptBarDock, setPromptBarDock] = useState<"bottom" | "top">("bottom");

  // Workspace switcher
  const [activeWorkspace, setActiveWorkspace] = useState("marketing-studio");
  const workspaces = [
    { id: "marketing-studio", label: "Marketing Studio" },
    { id: "higgsfield-ai", label: "Higgsfield AI" },
  ];

  // Filter and search
  const filteredCards = useMemo(() => {
    return (marketingStyleCards as unknown as StyleCard[]).filter((card) => {
      const matchesFilter = filterCategory === "All" || card.category === filterCategory;
      const matchesSearch =
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [filterCategory, searchQuery]);

  // Panel filtered cards
  const panelFilteredCards = useMemo(() => {
    return (marketingStyleCards as unknown as StyleCard[]).filter((card) =>
      card.title.toLowerCase().includes(panelSearchQuery.toLowerCase()) ||
      card.description.toLowerCase().includes(panelSearchQuery.toLowerCase())
    );
  }, [panelSearchQuery]);

  // Handle UGC chip click to open Style panel
  const handleUgcClick = () => {
    setSelectedMode("UGC");
    setSelectedStyle((current) => current || "ugc");
    setIsStylePanelOpen(true);
  };

  // Handle + button click to open Media Attach Panel
  const handleMediaAttachClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel("mediaAttach");
  };

  // Handle media attach
  const handleMediaAttach = (media: UploadedMedia[]) => {
    setAttachedProductMedia(media);
    setActiveFloatingPanel(null);
  };

  // Handle Hook button click
  const handleHookClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel("hook");
  };

  // Handle Hook selection
  const handleHookSelect = (hook: HookItem) => {
    setSelectedHook(hook);
  };

  // Handle App selector click
  const handleAppClick = () => {
    setSelectedTarget("app");
    setActiveFloatingPanel("app");
  };

  // Handle Product selector click
  const handleProductClick = () => {
    setSelectedTarget("product");
    setActiveFloatingPanel(null);
  };

  // Handle Setting button click
  const handleSettingClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel("setting");
  };

  // Handle Setting selection
  const handleSettingSelect = (setting: SettingItem) => {
    setSelectedSetting(setting);
    setActiveFloatingPanel(null);
  };

  // Handle Options button click
  const handleOptionsClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel(
      activeFloatingPanel === "options" ? null : "options"
    );
  };

  // Handle Product card click
  const handleProductCardClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel("product");
  };

  // Handle Product panel close
  const handleProductPanelClose = () => {
    setActiveFloatingPanel(null);
  };

  // Handle Create manually
  const handleCreateManually = () => {
    // Placeholder for manual product creation flow
    console.log("Create manually clicked");
  };

  // Handle Avatar card click
  const handleAvatarCardClick = () => {
    setIsStylePanelOpen(false);
    setActiveFloatingPanel("avatar");
  };

  // Handle Avatar panel close
  const handleAvatarPanelClose = () => {
    setActiveFloatingPanel(null);
  };

  // Handle App panel create manually
  const handleAppCreateManually = () => {
    setShowYourAppModal(true);
  };

  // Handle App panel close - revert to Product mode
  const handleAppPanelClose = () => {
    setSelectedTarget("product");
    setActiveFloatingPanel(null);
  };

  // Handle Your App modal close
  const handleYourAppModalClose = () => {
    setShowYourAppModal(false);
  };

  // Handle Create App
  const handleCreateApp = (data: {
    mode: "web" | "mobile";
    screenshotFile: File | null;
    screenshotPreviewUrl: string;
    productName: string;
    description: string;
  }) => {
    setAppUploadMode(data.mode);
    setAppScreenshot(data.screenshotFile);
    setAppScreenshotPreview(data.screenshotPreviewUrl);
    setAppProductName(data.productName);
    setAppDescription(data.description);
    setHasApp(true);
    setShowYourAppModal(false);
    setActiveFloatingPanel(null);
  };

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsStylePanelOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const handleAllGenerations = () => {
    router.push("?mode=all");
  };

  const handleFavorites = () => {
    router.push("?mode=favorites");
  };

  const handleGenerate = () => {
    console.log({
      target: selectedTarget,
      mode: selectedMode,
      style: selectedStyle,
      prompt: prompt,
    });
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{
        backgroundColor: "#071b10",
        backgroundImage: `
          linear-gradient(rgba(210,255,80,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(210,255,80,0.08) 1px, transparent 1px),
          radial-gradient(circle at 50% 18%, rgba(190,255,40,0.35), transparent 34%)
        `,
        backgroundSize: "44px 44px, 44px 44px, 100% 100%",
      }}
    >
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />

      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* LEFT SIDEBAR - Cinema Studio Tarzı */}
        <aside className="fixed left-2 top-[72px] z-30 hidden h-[calc(100vh-88px)] flex-col gap-2 overflow-hidden rounded-[1.25rem] border border-white/[0.04] bg-[#18191C] p-2 md:flex transition-all duration-300" style={{ width: sidebarCollapsed ? 52 : 231 }}>
          {/* Header */}
          <div className="flex h-11 items-center justify-between px-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="size-7 shrink-0 rounded-lg bg-gradient-to-br from-lime-300 to-green-600 flex items-center justify-center text-sm font-bold text-black">
                🎬
              </div>
              {!sidebarCollapsed && (
                <span className="truncate text-sm font-semibold text-white">Marketing Studio</span>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <ChevronDown className="size-4" />
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="mx-auto flex size-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <ChevronDown className="size-4 rotate-90" />
            </button>
          )}

          {/* Navigation */}
          <nav className="flex flex-col gap-0.5">
            <button
              onClick={() => setActiveSidebarView("home")}
              className={`flex h-9 items-center gap-3 rounded-xl text-sm font-medium text-white transition-colors hover:bg-white/5 ${
                activeSidebarView === "home" ? "bg-white/5" : ""
              } ${sidebarCollapsed ? "justify-center px-0" : "pl-[11px] pr-1.5"}`}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "linear-gradient(135deg, #222221 3.87%, #3B3C3A 93.45%)",
                  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.45)",
                }}
              >
                <Home className="size-[18px] text-white" strokeWidth={1.8} />
              </span>
              {!sidebarCollapsed && <span className="truncate">Home</span>}
            </button>

            <button
              onClick={() => setActiveSidebarView("allGenerations")}
              className={`flex h-9 items-center gap-3 rounded-xl text-sm font-medium text-white transition-colors hover:bg-white/5 ${
                activeSidebarView === "allGenerations" ? "bg-white/5" : ""
              } ${sidebarCollapsed ? "justify-center px-0" : "pl-[11px] pr-1.5"}`}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "linear-gradient(135deg, #4188BE 3.87%, #0E2772 93.45%)",
                  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.45)",
                }}
              >
                <Grid3x3 className="size-[18px] text-white" strokeWidth={1.8} />
              </span>
              {!sidebarCollapsed && <span className="truncate">All generations</span>}
            </button>

            <button
              onClick={() => setActiveSidebarView("favorites")}
              className={`flex h-9 items-center gap-3 rounded-xl text-sm font-medium text-white transition-colors hover:bg-white/5 ${
                activeSidebarView === "favorites" ? "bg-white/5" : ""
              } ${sidebarCollapsed ? "justify-center px-0" : "pl-[11px] pr-1.5"}`}
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "linear-gradient(135deg, #E251B4 3.87%, #8D1237 93.45%)",
                  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.45)",
                }}
              >
                <Heart className="size-[18px] text-white" strokeWidth={1.8} />
              </span>
              {!sidebarCollapsed && <span className="truncate">My favorites</span>}
            </button>
          </nav>

          {/* Tools */}
          <div className="mt-1 border-t border-white/[0.06] pt-2">
            <div className="flex items-center justify-between px-1.5 pb-1">
              {!sidebarCollapsed && (
                <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Tools</span>
              )}
            </div>

            <button
              className={`mt-1 flex h-9 w-full items-center gap-2 rounded-xl border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-sm font-medium text-white backdrop-blur-[3.7px] transition-colors hover:bg-white/[0.08] ${
                sidebarCollapsed ? "justify-center px-0" : "px-2"
              }`}
              style={{
                boxShadow: "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-white/15">
                <Link2 className="size-3.5" />
              </span>
              {!sidebarCollapsed && <span className="truncate">Url to Ad</span>}
            </button>

            <button
              className={`mt-1 flex h-9 w-full items-center gap-2 rounded-xl border border-[rgba(197,197,197,0.3)] bg-white/[0.04] text-sm font-medium text-white backdrop-blur-[3.7px] transition-colors hover:bg-white/[0.08] ${
                sidebarCollapsed ? "justify-center px-0" : "px-2"
              }`}
              style={{
                boxShadow: "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-white/15">
                <Paperclip className="size-3.5" />
              </span>
              {!sidebarCollapsed && <span className="truncate">Ad Reference</span>}
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className={`flex-1 overflow-auto transition-all duration-300 ${sidebarCollapsed ? "md:ml-[68px]" : "md:ml-[247px]"} ml-0 pb-[300px]`}>
          {activeSidebarView === "allGenerations" ? (
            // ALL GENERATIONS VIEW
            <section className="relative min-h-screen flex flex-col items-center justify-start px-8 py-20">
              <div className="relative z-10 text-center max-w-[1000px] mb-12 w-full">
                <p className="text-white/50 font-grotesk uppercase text-sm tracking-wider mb-6">ALL GENERATIONS</p>
                <h1 className="font-grotesk uppercase text-[40px] leading-[48px] font-bold tracking-[-1.6px] text-white/90 mb-8">
                  Your Generated Videos
                </h1>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-[1200px]">
                {[1, 2, 3, 4, 5, 6].map((idx) => (
                  <div
                    key={idx}
                    className="group rounded-3xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 transition-all hover:scale-[1.02] cursor-pointer"
                  >
                    <div className="aspect-[9/16] bg-gradient-to-br from-white/10 to-white/5 relative overflow-hidden flex items-center justify-center">
                      <div className="text-white/30 text-sm font-medium">Generation {idx}</div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </div>
                    <div className="p-4">
                      <p className="text-sm font-medium text-white mb-2">Video #{idx}</p>
                      <p className="text-xs text-white/50 mb-4">Generated today</p>
                      <div className="flex gap-2">
                        <button className="flex-1 h-8 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 transition-colors">
                          Download
                        </button>
                        <button className="flex-1 h-8 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 transition-colors">
                          Share
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : activeSidebarView === "favorites" ? (
            // MY FAVORITES VIEW
            <section className="relative min-h-screen flex flex-col items-center justify-center px-8 py-20">
              <div className="text-center">
                <p className="text-white/50 text-sm">My favorites coming soon</p>
              </div>
            </section>
          ) : (
            <>
              {/* HOME VIEW - VIDEO CARD STACK HERO */}
              <section className="flex flex-col items-center justify-center min-h-screen px-8">
                {/* HEADLINE */}
                <div className="text-center mb-16 max-w-2xl">
                  <h1 className="text-5xl font-extrabold text-white mb-4">
                    Turn a prompt into a marketing video
                  </h1>
                  <p className="text-white/60">
                    Describe what happens in the ad, all single-prompt ad videos will show up right here.
                  </p>
                </div>

                {/* VIDEO CARD STACK */}
                <div className="relative w-full max-w-2xl h-96">
                  {/* Left card - behind */}
                  <div className="absolute inset-0 rounded-2xl border border-white/10 bg-black/20 overflow-hidden" style={{
                    transform: 'translateX(-20px) translateY(20px) scale(0.95)',
                    zIndex: 1
                  }}>
                    <video
                      src="https://d8j0ntlcm91z4.cloudfront.net/user_3Cfdr00kbZ1hJCLpPQkaicInqxv/hf_20260603_150008_ee9cf142-7741-40e9-8076-897fb0947742.mp4"
                      poster="https://d8j0ntlcm91z4.cloudfront.net/user_3Cfdr00kbZ1hJCLpPQkaicInqxv/hf_20260603_150008_ee9cf142-7741-40e9-8076-897fb0947742.jpg"
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Center card - large, top */}
                  <div className="absolute inset-0 rounded-2xl border border-white/10 bg-black/20 overflow-hidden" style={{
                    zIndex: 3,
                    transform: 'translateY(0)'
                  }}>
                    <video
                      src="https://static.higgsfield.ai/marketing-studio-presets/ugc.mp4"
                      poster="https://static.higgsfield.ai/marketing-studio-presets/ugc.jpg"
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Right card - behind */}
                  <div className="absolute inset-0 rounded-2xl border border-white/10 bg-black/20 overflow-hidden" style={{
                    transform: 'translateX(20px) translateY(20px) scale(0.95)',
                    zIndex: 1
                  }}>
                    <video
                      src="https://static.higgsfield.ai/ms-modes/ugc_gadget_saved_me.mp4"
                      poster="https://static.higgsfield.ai/ms-modes/ugc_gadget_saved_me.jpg"
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </section>
            </>
          )}
        </main>

        {/* COMPOSER BOX - SHARED ACROSS ALL VIEWS */}
        <section
          className={`fixed left-0 right-0 px-8 py-4 bg-gradient-to-t from-[#0a0b0e] to-transparent border-white/5 transition-all duration-300 ${
            promptBarDock === "bottom"
              ? "bottom-0 border-t"
              : "top-0 border-b"
          }`}
        >
          {/* DOCK TOGGLE - visible control to move prompt bar */}
          <div className={`flex justify-center mb-2 ${promptBarDock === "top" ? "" : "hidden"}`}>
            <button
              onClick={() => setPromptBarDock("bottom")}
              className="text-xs px-2 py-1 rounded bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            >
              ↓ Dock to Bottom
            </button>
          </div>
          <div className={`mx-auto flex w-[min(980px,calc(100vw-260px-16px))] items-stretch gap-2 ${sidebarCollapsed ? "ml-[32px]" : "ml-[95px]"}`}>
            {/* LEFT PRODUCT/APP SELECTOR */}
            <div className="h-[116px] w-[70px] rounded-[22px] bg-[#23252b] border border-white/10 p-1 flex flex-col gap-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <button
                onClick={handleProductClick}
                className={`flex-1 rounded-[18px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                  selectedTarget === "product"
                    ? "bg-[#3a3d45] text-white"
                    : "text-white/55 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-[10px]">📱</span>
                <span>Product</span>
              </button>
              <button
                onClick={handleAppClick}
                className={`flex-1 rounded-[18px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                  selectedTarget === "app"
                    ? "bg-[#3a3d45] text-white"
                    : "text-white/55 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-[10px]">⌚</span>
                <span>App</span>
              </button>
            </div>

            {/* MAIN COMPOSER BAR - ONE CONNECTED HORIZONTAL UNIT */}
            <div className="relative flex h-[116px] flex-1 items-stretch rounded-[24px] border border-white/10 bg-[#24262b] p-3 shadow-[0_8px_0_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              {/* LEFT: PLUS BUTTON + PROMPT INPUT */}
              <div className="flex min-w-0 flex-1 flex-col justify-between pr-3">
                {/* Top Row: Plus + Textarea */}
                <div className="flex items-start gap-3">
                  <button
                    onClick={handleMediaAttachClick}
                    className="flex-shrink-0 size-8 rounded-xl bg-white/8 text-white/80 hover:bg-white/12 flex items-center justify-center transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what happens in the ad..."
                    className="min-h-[32px] flex-1 resize-none bg-transparent pt-1 text-sm text-white outline-none placeholder:text-white/55"
                  />
                </div>

                {/* Bottom Row: Chips */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUgcClick}
                    className={`h-8 rounded-lg px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      selectedMode === "UGC"
                        ? "bg-cyan-400/20 text-cyan-300"
                        : "bg-white/7 text-white hover:bg-white/10"
                    }`}
                  >
                    <span className="text-[9px]">▼</span> UGC
                  </button>
                  <button
                    onClick={handleHookClick}
                    className="h-8 rounded-lg px-3 bg-white/7 text-white hover:bg-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <span className="text-[9px]">🎯</span> Hook {selectedHook ? `: ${selectedHook.title}` : ""}
                  </button>
                  <button
                    onClick={handleSettingClick}
                    className="h-8 rounded-lg px-3 bg-white/7 text-white hover:bg-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <span className="text-[9px]">🌍</span> {selectedSetting ? selectedSetting.title : "Setting"}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        activeFloatingPanel === "setting" ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <button
                    ref={optionsButtonRef}
                    onClick={handleOptionsClick}
                    className="h-8 w-8 rounded-lg bg-white/7 text-white hover:bg-white/10 flex items-center justify-center transition-colors hover:scale-[1.03] active:scale-[0.97]"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* RIGHT: PRODUCT TILE + AVATAR TILE + ATTACHED MEDIA + GENERATE */}
              <div className="flex shrink-0 items-center gap-2">
                {/* PRODUCT TILE */}
                <button
                  onClick={handleProductCardClick}
                  className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors cursor-pointer"
                >
                  <div className="self-start size-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
                    <Plus className="h-3 w-3" />
                  </div>
                  <span>PRODUCT</span>
                </button>

                {/* AVATAR TILE */}
                <button
                  onClick={handleAvatarCardClick}
                  className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors cursor-pointer"
                >
                  <div className="self-start size-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
                    <Plus className="h-3 w-3" />
                  </div>
                  <span>AVATAR</span>
                </button>

                {/* ATTACHED MEDIA PREVIEW - Shows first attached image */}
                {attachedProductMedia.length > 0 && (
                  <div className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors overflow-hidden group">
                    <img
                      src={attachedProductMedia[0].previewUrl}
                      alt="Attached media"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-colors" />
                    <span className="relative z-10 text-xs bg-cyan-400/80 text-black px-1 rounded">
                      {attachedProductMedia.length}
                    </span>
                    <span className="relative z-10">MEDIA</span>
                  </div>
                )}

                {/* GENERATE BUTTON */}
                <button
                  onClick={handleGenerate}
                  className="h-20 w-[120px] rounded-xl bg-[linear-gradient(135deg,#1fffd0_0%,#00c8ff_100%)] hover:opacity-90 text-black flex flex-col items-center justify-center font-bold text-sm transition-opacity"
                >
                  <span>GENERATE</span>
                  <div className="text-[10px] mt-1">✦ 156 130</div>
                </button>
              </div>
            </div>
          </div>

          {/* DOCK TOGGLE - visible control to move prompt bar */}
          <div className={`flex justify-center mt-2 ${promptBarDock === "bottom" ? "" : "hidden"}`}>
            <button
              onClick={() => setPromptBarDock("top")}
              className="text-xs px-2 py-1 rounded bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            >
              ↑ Dock to Top
            </button>
          </div>
        </section>
      </div>

      {/* MEDIA ATTACH PANEL */}
      {activeFloatingPanel === "mediaAttach" && (
        <MediaAttachPanel
          isOpen={activeFloatingPanel === "mediaAttach"}
          onClose={() => setActiveFloatingPanel(null)}
          onAttach={handleMediaAttach}
          promptBarDock={promptBarDock}
        />
      )}

      {/* HOOK PANEL */}
      {activeFloatingPanel === "hook" && (
        <HookPanel
          isOpen={activeFloatingPanel === "hook"}
          onClose={() => setActiveFloatingPanel(null)}
          onSelectHook={handleHookSelect}
          selectedHookId={selectedHook?.id}
          promptBarDock={promptBarDock}
        />
      )}

      {/* ADD YOUR APP PANEL - DEPRECATED: replaced with AppPanel + YourAppModal */}
      {/* Old component removed to avoid conflicts */}

      {/* SETTING PANEL */}
      {activeFloatingPanel === "setting" && (
        <SettingPanel
          isOpen={activeFloatingPanel === "setting"}
          onClose={() => setActiveFloatingPanel(null)}
          onSelectSetting={handleSettingSelect}
          selectedSettingId={selectedSetting?.id}
          promptBarDock={promptBarDock}
        />
      )}

      {/* OPTIONS DROPDOWN */}
      <OptionsDropdown
        isOpen={activeFloatingPanel === "options"}
        onClose={() => setActiveFloatingPanel(null)}
        aspectRatio={aspectRatio}
        onAspectRatioChange={setAspectRatio}
        quality={quality}
        onQualityChange={setQuality}
        duration={duration}
        onDurationChange={setDuration}
        triggerButtonRef={optionsButtonRef}
        promptBarDock={promptBarDock}
      />

      {/* PRODUCT PANEL */}
      {activeFloatingPanel === "product" && (
        <ProductPanel
          isOpen={activeFloatingPanel === "product"}
          onClose={handleProductPanelClose}
          productUrl={productUrl}
          onProductUrlChange={setProductUrl}
          onCreateManually={handleCreateManually}
          promptBarDock={promptBarDock}
        />
      )}

      {/* AVATAR PANEL */}
      {activeFloatingPanel === "avatar" && (
        <SelectAvatarPanel
          isOpen={activeFloatingPanel === "avatar"}
          onClose={handleAvatarPanelClose}
          avatarFilter={avatarFilter}
          onAvatarFilterChange={setAvatarFilter}
          avatarGender={avatarGender}
          onAvatarGenderChange={setAvatarGender}
          avatarSearchQuery={avatarSearchQuery}
          onAvatarSearchQueryChange={setAvatarSearchQuery}
          selectedAvatarId={selectedAvatarId}
          onAvatarSelect={setSelectedAvatarId}
          promptBarDock={promptBarDock}
        />
      )}

      {/* APP PANEL */}
      {activeFloatingPanel === "app" && (
        <AppPanel
          isOpen={activeFloatingPanel === "app"}
          onClose={handleAppPanelClose}
          hasApp={hasApp}
          onCreateManually={handleAppCreateManually}
          promptBarDock={promptBarDock}
        />
      )}

      {/* YOUR APP MODAL */}
      {showYourAppModal && (
        <YourAppModal
          isOpen={showYourAppModal}
          onClose={handleYourAppModalClose}
          onCreateApp={handleCreateApp}
        />
      )}

      {/* TARGET PANEL MODAL */}
      {isStylePanelOpen && (
        <div
          className="fixed inset-0 z-[999] bg-black/40 backdrop-blur-sm"
          onClick={() => setIsStylePanelOpen(false)}
        />
      )}

      {isStylePanelOpen && (
        <div
          className="fixed z-[1000] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(720px,calc(100vw-48px))] h-[min(560px,calc(100vh-48px))] rounded-3xl border border-white/5 bg-[#0f1b15] p-2 text-white shadow-xl overflow-hidden flex flex-col"
          role="dialog"
          onClick={(e) => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="flex shrink-0 items-center justify-between rounded-[20px] px-3 h-11 bg-white/5">
            <h2 className="text-sm font-medium leading-5">Style</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setIsStylePanelOpen(false)}
              className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* SHOWCASE SECTION */}
          <div className="shrink-0 overflow-visible" style={{ height: 140 }}>
            <div className="relative z-1 flex h-[140px] shrink-0 items-start overflow-visible rounded-2xl gap-6 px-6 py-4">
              {/* LEFT TEXT AREA */}
              <div className="w-[280px] flex flex-col justify-start">
                <h3 className="font-grotesk text-[24px] font-bold uppercase leading-7 text-white tracking-[-1px]">
                  PICK THE<br />STYLE THAT<br />HITS
                </h3>
                <p className="mt-3 w-[250px] text-xs font-medium leading-4 text-white/60">
                  From unboxing to UGC - choose the type of video that fits your product and audience.
                </p>
              </div>

              {/* SHOWCASE IMAGES */}
              <div className="relative h-[170px] min-w-px flex-1 overflow-hidden">
                {/* Left Image */}
                <img
                  src="/assets/higgsfield/marketing-studio/product/showcase/format-left.webp"
                  alt="Format Left"
                  className="absolute"
                  style={{
                    left: "20px",
                    top: "32px",
                    zIndex: 1,
                    width: "130px",
                    height: "130px",
                    borderRadius: "9999px",
                    border: "2px solid rgba(255,255,255,0.10)",
                    transform: "rotate(-10deg)",
                    objectFit: "cover",
                  }}
                />
                {/* Center Image */}
                <img
                  src="/assets/higgsfield/marketing-studio/product/showcase/format-center.webp"
                  alt="Format Center"
                  className="absolute"
                  style={{
                    left: "150px",
                    top: "10px",
                    zIndex: 3,
                    width: "130px",
                    height: "170px",
                    borderRadius: "20px",
                    border: "2px solid rgba(255,255,255,0.10)",
                    transform: "rotate(-2.11deg)",
                    objectFit: "cover",
                  }}
                />
                {/* Right Image */}
                <img
                  src="/assets/higgsfield/marketing-studio/product/showcase/format-right.webp"
                  alt="Format Right"
                  className="absolute"
                  style={{
                    left: "260px",
                    top: "30px",
                    zIndex: 2,
                    width: "95px",
                    height: "180px",
                    borderRadius: "20px",
                    border: "2px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.05)",
                    transform: "rotate(4.55deg)",
                    objectFit: "cover",
                  }}
                />
              </div>
            </div>
          </div>

          {/* SEARCH AND GRID AREA */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white/5">
            {/* SEARCH */}
            <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-white/50">
              <input
                type="text"
                placeholder="Search"
                aria-label="Search video styles"
                value={panelSearchQuery}
                onChange={(e) => setPanelSearchQuery(e.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-xs leading-4 text-white outline-none placeholder:text-white/50"
              />
            </div>

            {/* CARD GRID */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2">
              <div className="grid grid-cols-2 gap-1.5 pb-4 md:grid-cols-4">
                {panelFilteredCards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => {
                      setSelectedStyle(card.id);
                      setIsStylePanelOpen(false);
                    }}
                    className="marketing-video-mode-card flex flex-col gap-2 text-left transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99]"
                  >
                    {/* Media */}
                    <div
                      className={`relative h-40 overflow-hidden rounded-2xl border cursor-pointer transition-all ${
                        selectedStyle === card.id
                          ? "border-cyan-400 ring-2 ring-cyan-300"
                          : "border-white/5 bg-[#1a2420]"
                      }`}
                    >
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5">
                        <span className="text-white/30 text-[10px] font-medium text-center px-2">
                          {card.title}
                        </span>
                      </div>
                    </div>

                    {/* Text */}
                    <div>
                      <p className="truncate text-xs font-semibold leading-4 text-white">
                        {card.title}
                      </p>
                      <p className="truncate text-xs leading-4 text-white/60">
                        {card.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

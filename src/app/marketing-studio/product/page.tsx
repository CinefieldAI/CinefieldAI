"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Navbar from "@/components/landing/Navbar";
import { X } from "lucide-react";
import { marketingStyleCards } from "@/data/marketingStyleCards";
import MediaAttachPanel, { UploadedMedia } from "@/components/marketing-studio/MediaAttachPanel";
import HookPanel, { HookItem } from "@/components/marketing-studio/HookPanel";
import SettingPanel, { SettingItem } from "@/components/marketing-studio/SettingPanel";
import OptionsDropdown from "@/components/marketing-studio/OptionsDropdown";
import ProductPanel from "@/components/marketing-studio/ProductPanel";
import SelectAvatarPanel from "@/components/marketing-studio/SelectAvatarPanel";
import AppPanel from "@/components/marketing-studio/AppPanel";
import YourAppModal from "@/components/marketing-studio/YourAppModal";
import HomeHeroVideoStack from "@/components/marketing-studio/HomeHeroVideoStack";
import MarketingStudioSidebar from "@/components/marketing-studio/MarketingStudioSidebar";
import ComposerBar, {
  MARKETING_COMPOSER_DEFAULT_HEIGHT,
  MARKETING_COMPOSER_DEFAULT_WIDTH,
  MARKETING_COMPOSER_MAX_HEIGHT,
  MARKETING_COMPOSER_MAX_WIDTH,
} from "@/components/marketing-studio/ComposerBar";
import MarketingFormatExplore from "@/components/marketing-studio/MarketingFormatExplore";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";

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
  const [activeSidebarView, setActiveSidebarView] = useState<"home" | "allGenerations" | "favorites">("home");
  const [selectedTarget, setSelectedTarget] = useState<TargetType>("product");
  const [selectedMode, setSelectedMode] = useState<ModeType>("UGC");
  const [selectedStyle, setSelectedStyle] = useState<string>("ugc");
  const searchQuery = "";
  const [filterCategory, setFilterCategory] = useState<Category>("All");
  const [prompt, setPrompt] = useState("");
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(false);
  const [panelSearchQuery, setPanelSearchQuery] = useState("");
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isNavbarVisible, setIsNavbarVisible] = useState(false);
  const promptBarDock = "bottom" as const;

  // Global pulse delay sync for lighting
  useEffect(() => {
    if (typeof window !== "undefined") {
      const delay = `-${((Date.now() % 20000) / 1000).toFixed(2)}s`;
      document.documentElement.style.setProperty("--global-pulse-delay", delay);
    }
  }, []);

  // Hover-reveal & Scroll-triggered Navbar logic for /marketing-studio/product
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsNavbarVisible(true);
      } else {
        setIsNavbarVisible(false);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Do NOT reveal navbar when hovering over sidebar or toggle button region (X < 350px)
      if (e.clientX < 350) {
        if (window.scrollY <= 20) {
          setIsNavbarVisible(false);
        }
        return;
      }

      if (e.clientY <= 60) {
        setIsNavbarVisible(true);
      } else if (e.clientY > 110 && window.scrollY <= 20) {
        setIsNavbarVisible(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // Composer wrapper ref for sticky behavior
  const composerWrapperRef = useRef<HTMLDivElement>(null);
  const [showStickyComposer, setShowStickyComposer] = useState(false);
  const [composerWidth, setComposerWidth] = useState(
    MARKETING_COMPOSER_DEFAULT_WIDTH,
  );
  const [composerHeight, setComposerHeight] = useState(
    MARKETING_COMPOSER_DEFAULT_HEIGHT,
  );
  const [maxComposerWidth, setMaxComposerWidth] = useState(
    MARKETING_COMPOSER_MAX_WIDTH,
  );
  const [maxComposerHeight, setMaxComposerHeight] = useState(
    MARKETING_COMPOSER_MAX_HEIGHT,
  );

  useEffect(() => {
    const updateComposerBounds = () => {
      setMaxComposerWidth(
        Math.max(
          320,
          Math.min(MARKETING_COMPOSER_MAX_WIDTH, window.innerWidth - 32),
        ),
      );
      setMaxComposerHeight(
        Math.max(
          MARKETING_COMPOSER_DEFAULT_HEIGHT,
          Math.min(MARKETING_COMPOSER_MAX_HEIGHT, window.innerHeight - 160),
        ),
      );
    };

    updateComposerBounds();
    window.addEventListener("resize", updateComposerBounds);
    return () => window.removeEventListener("resize", updateComposerBounds);
  }, []);

  const composerResize = usePromptSurfaceResize({
    width: composerWidth,
    height: composerHeight,
    minWidth: Math.min(MARKETING_COMPOSER_DEFAULT_WIDTH, maxComposerWidth),
    maxWidth: maxComposerWidth,
    minHeight: MARKETING_COMPOSER_DEFAULT_HEIGHT,
    maxHeight: maxComposerHeight,
    defaultWidth: MARKETING_COMPOSER_DEFAULT_WIDTH,
    defaultHeight: MARKETING_COMPOSER_DEFAULT_HEIGHT,
    setWidth: setComposerWidth,
    setHeight: setComposerHeight,
    storageKey: "marketingPromptDimensions",
  });

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

  // Prevent page scroll when any floating panel or modal is open
  useEffect(() => {
    if (activeFloatingPanel !== null || isStylePanelOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [activeFloatingPanel, isStylePanelOpen]);

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
  const handleCreateApp = () => {
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

  // Scroll listener for sticky composer on Home view
  useEffect(() => {
    if (activeSidebarView !== "home" || !composerWrapperRef.current) {
      setShowStickyComposer(false);
      return;
    }

    const handleScroll = () => {
      if (!composerWrapperRef.current) return;
      const rect = composerWrapperRef.current.getBoundingClientRect();
      setShowStickyComposer(rect.top < -100);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      setShowStickyComposer(false);
    };
  }, [activeSidebarView]);

  // Simple scroll-based sticky for All Generations
  useEffect(() => {
    if (activeSidebarView !== "allGenerations") return;

    const handleScroll = () => {
      // Show sticky after scrolling 100px on All Generations
      setShowStickyComposer(window.scrollY > 100);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      setShowStickyComposer(false);
    };
  }, [activeSidebarView]);

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
      className="min-h-screen w-full flex flex-col"
      style={{
        backgroundColor: "#0d0f10",
        backgroundImage: `
          linear-gradient(rgba(242, 138, 98, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(242, 138, 98, 0.12) 1px, transparent 1px),
          radial-gradient(ellipse 75% 68% at 50% 0%, rgba(242, 138, 98, 0.68) 0%, rgba(230, 120, 78, 0.38) 42%, rgba(217, 105, 65, 0.16) 72%, transparent 90%),
          linear-gradient(90deg, #0d0f10 0%, #1c120f 50%, #0d0f10 100%)
        `,
        backgroundSize: "44px 44px, 44px 44px, 100% 760px, 100% 100%",
        backgroundRepeat: "repeat, repeat, no-repeat, no-repeat",
      }}
    >

      {/* TOP HOVER SENSOR STRIP (Excludes sidebar & toggle button region X < 350px) */}
      <div
        onMouseEnter={() => setIsNavbarVisible(true)}
        className="fixed top-0 left-[350px] right-0 h-4 z-40"
      />

      {/* HOVER-REVEAL NAVBAR (Only on /marketing-studio/product) */}
      <div
        onMouseEnter={() => setIsNavbarVisible(true)}
        onMouseLeave={() => setIsNavbarVisible(false)}
        className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ease-out ${
          isNavbarVisible ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <Navbar
          activePanel={null}
          onOpenImagePanel={noop}
          onOpenVideoPanel={noop}
          onOpenAudioPanel={noop}
          onSetView={noop}
        />
      </div>

      {/* OFFICIAL HIGGSFIELD SIDEBAR WITH COLLAPSE TOGGLE */}
      <MarketingStudioSidebar
        activeSidebarView={activeSidebarView}
        onViewChange={setActiveSidebarView}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      <div className="flex flex-1" style={{ minHeight: "calc(100vh - 72px)" }}>
        {/* MAIN CONTENT AREA */}
        <main
          className="relative flex-1 overflow-auto w-full"
          style={{
            minHeight: "calc(100vh - 72px)",
            paddingBottom: "calc(190px + 48px)",
          }}
        >
              {activeSidebarView === "allGenerations" && (
                // ALL GENERATIONS VIEW - EMPTY STATE
                <div ref={composerWrapperRef} className="relative w-full">
                  <HomeHeroVideoStack />
                </div>
              )}

              {activeSidebarView === "favorites" && (
                // MY FAVORITES VIEW
                <section className="relative min-h-screen flex flex-col items-center justify-center px-8 py-20">
                  <div className="text-center">
                    <p className="text-white/50 text-sm">My favorites coming soon</p>
                  </div>
                </section>
              )}

              {activeSidebarView === "home" && (
                // HOME VIEW - MAIN PRODUCT LANDING WITH HERO, COMPOSER, AND STYLE CARDS
                <section className="relative mx-auto mt-4 flex w-full max-w-[1232px] flex-col items-center gap-8 px-8 pb-20">
                  {/* HERO SECTION */}
                  <div className="relative z-10 flex min-h-[238px] w-full max-w-[640px] flex-col items-center justify-center text-center">
                    <p className="mb-4 font-grotesk text-sm font-bold uppercase tracking-normal text-white/50">MARKETING STUDIO</p>
                    <h1 className="font-grotesk text-[40px] font-bold uppercase leading-[48px] tracking-[-1.6px] text-white">
                      TURN ANY PRODUCT<br />INTO A VIDEO AD
                    </h1>
                  </div>

                  {/* INLINE COMPOSER - Normal flow */}
                  <div ref={composerWrapperRef} className="relative z-10 flex min-h-[166px] w-full justify-center pb-8">
                    <ComposerBar
                      prompt={prompt}
                      onPromptChange={setPrompt}
                      selectedTarget={selectedTarget}
                      onProductClick={handleProductClick}
                      onAppClick={handleAppClick}
                      selectedMode={selectedMode}
                      onUgcClick={handleUgcClick}
                      onHookClick={handleHookClick}
                      onSettingClick={handleSettingClick}
                      onMediaAttachClick={handleMediaAttachClick}
                      onOptionsClick={handleOptionsClick}
                      selectedHook={selectedHook}
                      selectedSetting={selectedSetting}
                      activeFloatingPanel={activeFloatingPanel}
                      optionsButtonRef={optionsButtonRef}
                      attachedProductMedia={attachedProductMedia}
                      onProductCardClick={handleProductCardClick}
                      onAvatarCardClick={handleAvatarCardClick}
                      onGenerate={handleGenerate}
                      resizeWidth={composerWidth}
                      resizeHeight={composerHeight}
                      resizeController={composerResize}
                    />
                  </div>

                  {/* EXPLORE FORMAT CARDS GRID */}
                  <MarketingFormatExplore />
                </section>
              )}
            </main>
          </div>
          {showStickyComposer && (activeSidebarView === "home" || activeSidebarView === "allGenerations") && (
            <div className="fixed left-0 right-0 bottom-4 z-40 px-8 pointer-events-none">
              <div className="marketing-sticky-composer-enter pointer-events-auto">
                <ComposerBar
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  selectedTarget={selectedTarget}
                  onProductClick={handleProductClick}
                  onAppClick={handleAppClick}
                  selectedMode={selectedMode}
                  onUgcClick={handleUgcClick}
                  onHookClick={handleHookClick}
                  onSettingClick={handleSettingClick}
                  onMediaAttachClick={handleMediaAttachClick}
                  onOptionsClick={handleOptionsClick}
                  selectedHook={selectedHook}
                  selectedSetting={selectedSetting}
                  activeFloatingPanel={activeFloatingPanel}
                  optionsButtonRef={optionsButtonRef}
                  attachedProductMedia={attachedProductMedia}
                  onProductCardClick={handleProductCardClick}
                  onAvatarCardClick={handleAvatarCardClick}
                  onGenerate={handleGenerate}
                  resizeWidth={composerWidth}
                  resizeHeight={composerHeight}
                  resizeController={composerResize}
                />
              </div>
            </div>
          )}

          <style jsx global>{`
            @keyframes marketing-sticky-composer-enter {
              from {
                opacity: 0;
                transform: translate3d(0, 28px, 0);
              }
              to {
                opacity: 1;
                transform: translate3d(0, 0, 0);
              }
            }

            .marketing-sticky-composer-enter {
              animation: marketing-sticky-composer-enter 420ms
                cubic-bezier(0.22, 1, 0.36, 1) both;
              will-change: opacity, transform;
            }

            @media (prefers-reduced-motion: reduce) {
              .marketing-sticky-composer-enter {
                animation: none;
              }
            }
          `}</style>

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

        {/* STYLE MODAL BACKDROP & DIALOG */}
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

"use client";

import { useState, useMemo } from "react";
import { X } from "lucide-react";

export interface HookItem {
  id: string;
  title: string;
  description: string;
  category: "Stunt" | "Subtle";
  videoUrl: string;
}

interface HookPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHook: (hook: HookItem) => void;
  selectedHookId?: string;
  promptBarDock?: "top" | "bottom";
}

const HOOK_ITEMS: HookItem[] = [
  {
    id: "product-hit",
    title: "Product Hit",
    description: "Object flies into frame, hits subject. Brief reaction → pivot to product.",
    category: "Stunt",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/0376d63f-7fcb-4622-bdd0-4dc700d44cc6.mp4"
  },
  {
    id: "spicy",
    title: "Spicy",
    description: "",
    category: "Subtle",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/310818fe-e1af-4e3c-a8c2-3d4a3579365f.mp4"
  },
  {
    id: "interview",
    title: "Interview",
    description: "",
    category: "Subtle",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/913b0ed2-bbbb-4626-a491-e9335d250eaf.mp4"
  },
  {
    id: "random-object-mic",
    title: "Random Object Mic",
    description: "",
    category: "Stunt",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/381965b9-5d4b-4e6a-a9a1-be94a6cbb66d.mp4"
  },
  {
    id: "product-crash",
    title: "Product Crash",
    description: "",
    category: "Subtle",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/e106fdf3-b64d-4d85-867c-47fe5b9dc381.mp4"
  },
  {
    id: "blizzard",
    title: "Blizzard",
    description: "",
    category: "Stunt",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/b46b6584-a4c7-4228-8b51-927e1aebcfed.mp4"
  },
  {
    id: "camera-bump",
    title: "Camera Bump",
    description: "",
    category: "Subtle",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/868ca5a9-cf6f-460a-959b-76706deee95b.mp4"
  },
  {
    id: "product-dodge",
    title: "Product Dodge",
    description: "",
    category: "Stunt",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/81a3aed0-6db5-4c8f-9f56-8aab62e81b22.mp4"
  },
  {
    id: "epic-fail",
    title: "Epic Fail",
    description: "",
    category: "Subtle",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/6b1698c1-5f82-4854-8a32-de3807618082.mp4"
  }
];

type HookCategory = "All" | "Stunt" | "Subtle";

export default function HookPanel({
  isOpen,
  onClose,
  onSelectHook,
  selectedHookId,
  promptBarDock = "bottom",
}: HookPanelProps) {
  const [activeCategory, setActiveCategory] = useState<HookCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHooks = useMemo(() => {
    let result = HOOK_ITEMS;

    if (activeCategory !== "All") {
      result = result.filter((hook) => hook.category === activeCategory);
    }

    if (searchQuery) {
      result = result.filter(
        (hook) =>
          hook.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          hook.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  }, [activeCategory, searchQuery]);

  if (!isOpen) return null;

  const handleHookSelect = (hook: HookItem) => {
    onSelectHook(hook);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed z-[999] left-1/2 -translate-x-1/2 w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-16px)] rounded-[24px] border border-white/5 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-col transition-all duration-300 ${
          promptBarDock === "bottom"
            ? "bottom-[160px]"
            : "top-[160px]"
        }`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Hook</h2>
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close hooks"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* HERO SECTION */}
        <div className="shrink-0 px-6 py-8 border-b border-white/5">
          <div className="flex gap-12">
            {/* Text */}
            <div className="flex-1">
              <h3 className="text-3xl font-bold uppercase tracking-tight mb-4">
                Hooks That Stop The Scroll
              </h3>
              <p className="text-sm text-white/60">
                The first 3 seconds decide if your ad gets watched or skipped. Pick a proven opener.
              </p>
            </div>

            {/* Images */}
            <div className="relative w-48 h-40">
              <img
                src="https://static.higgsfield.ai/marketing-showcase/hook_1.webp"
                alt="Hook showcase 1"
                className="absolute rounded-full border border-white/10 shadow-sm"
                style={{
                  width: "130px",
                  height: "130px",
                  left: "0",
                  top: "0",
                  transform: "rotate(-10deg)",
                  objectFit: "cover",
                }}
              />
              <img
                src="https://static.higgsfield.ai/marketing-showcase/hook_2.webp"
                alt="Hook showcase 2"
                className="absolute rounded-2xl border border-white/10 shadow-sm"
                style={{
                  width: "120px",
                  height: "140px",
                  left: "60px",
                  top: "5px",
                  transform: "rotate(-2deg)",
                  objectFit: "cover",
                }}
              />
              <img
                src="https://static.higgsfield.ai/marketing-showcase/hook_3.webp"
                alt="Hook showcase 3"
                className="absolute rounded-2xl border border-white/10 shadow-sm"
                style={{
                  width: "100px",
                  height: "145px",
                  left: "130px",
                  top: "10px",
                  transform: "rotate(4deg)",
                  objectFit: "cover",
                }}
              />
            </div>
          </div>
        </div>

        {/* SEARCH + FILTERS */}
        <div className="shrink-0 px-6 py-4 border-b border-white/5 space-y-4">
          {/* Search */}
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/50 focus:outline-none focus:border-white/20 text-sm"
          />

          {/* Category Filters */}
          <div className="flex gap-2">
            {(["All", "Stunt", "Subtle"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-white/20 text-white"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* HOOK GRID */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {filteredHooks.length > 0 ? (
            <div className="grid grid-cols-4 gap-4">
              {filteredHooks.map((hook) => {
                const isSelected = selectedHookId === hook.id;
                return (
                  <button
                    key={hook.id}
                    onClick={() => handleHookSelect(hook)}
                    className={`relative rounded-2xl overflow-hidden transition-all group ${
                      isSelected
                        ? "ring-2 ring-cyan-400"
                        : "hover:ring-1 hover:ring-white/50"
                    }`}
                  >
                    <video
                      src={hook.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      disablePictureInPicture
                      className="w-full h-full object-cover"
                      style={{ aspectRatio: "9/16" }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-end justify-end p-3">
                      <p className="text-xs font-semibold text-white text-center w-full">
                        {hook.title}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-cyan-400 flex items-center justify-center">
                          <span className="text-black text-sm font-bold">✓</span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-white/50 text-sm">No hooks found</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

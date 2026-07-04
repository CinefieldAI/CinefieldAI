"use client";

import { useState, useMemo } from "react";
import { X } from "lucide-react";

export interface SettingItem {
  id: string;
  title: string;
  description: string;
  category: "Realistic" | "Unrealistic";
  videoUrl: string;
}

interface SettingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSetting: (setting: SettingItem) => void;
  selectedSettingId?: string;
}

const SETTING_ITEMS: SettingItem[] = [
  {
    id: "bedroom",
    title: "Bedroom",
    description: "On bed or propped against pillows, soft window light. Unmade bed, cozy...",
    category: "Realistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/bedroom.mp4"
  },
  {
    id: "airplane-wing",
    title: "Airplane Wing",
    description: "Person sits on airplane wing mid-flight at altitude. Casual product review...",
    category: "Unrealistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/airplane-wing.mp4"
  },
  {
    id: "nature",
    title: "Nature",
    description: "Outdoors — trail, park, beach, or garden depending on product. Natural...",
    category: "Realistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/nature.mp4"
  },
  {
    id: "roofing",
    title: "Roofing",
    description: "Person on the edge of a skyscraper rooftop, city skyline stretched out...",
    category: "Unrealistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/roofing.mp4"
  },
  {
    id: "office",
    title: "Office",
    description: "Corporate setting with desks, computers, and professional background...",
    category: "Realistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/office.mp4"
  },
  {
    id: "underwater",
    title: "Underwater",
    description: "Submerged in crystal clear water with coral and marine life visible...",
    category: "Unrealistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/underwater.mp4"
  },
  {
    id: "kitchen",
    title: "Kitchen",
    description: "Modern kitchen with bright countertops and stainless steel appliances...",
    category: "Realistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/kitchen.mp4"
  },
  {
    id: "space",
    title: "Space",
    description: "Floating in outer space with planets and stars visible all around...",
    category: "Unrealistic",
    videoUrl: "https://cdn.higgsfield.ai/marketing_studio_setup/space.mp4"
  }
];

type SettingCategory = "All" | "Realistic" | "Unrealistic";

export default function SettingPanel({
  isOpen,
  onClose,
  onSelectSetting,
  selectedSettingId,
}: SettingPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SettingCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const filteredSettings = useMemo(() => {
    let result = SETTING_ITEMS;

    if (activeCategory !== "All") {
      result = result.filter((setting) => setting.category === activeCategory);
    }

    if (searchQuery) {
      result = result.filter(
        (setting) =>
          setting.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          setting.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  }, [activeCategory, searchQuery]);

  const handleSettingSelect = (setting: SettingItem) => {
    onSelectSetting(setting);
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
        className="fixed z-[999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-16px)] rounded-[24px] border border-white/5 bg-[#0f1b15] text-white shadow-xl overflow-hidden flex flex-col"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Setting</h2>
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* HERO SECTION */}
        <div className="shrink-0 px-6 py-8 border-b border-white/5">
          <div className="flex gap-12">
            {/* Text */}
            <div className="flex-1">
              <h3 className="text-3xl font-bold uppercase tracking-tight mb-4 text-[#d2ff50]">
                Settings That Set<br />The Scene
              </h3>
              <p className="text-sm text-white/60">
                Choose where the story unfolds. Pick a setting that frames your ad with the right mood.
              </p>
            </div>

            {/* Images */}
            <div className="relative w-48 h-40">
              <img
                src="https://static.higgsfield.ai/marketing-showcase/setting_1.webp"
                alt="Setting showcase 1"
                className="absolute rounded-2xl border border-white/10 shadow-sm"
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
                src="https://static.higgsfield.ai/marketing-showcase/setting_2.webp"
                alt="Setting showcase 2"
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
                src="https://static.higgsfield.ai/marketing-showcase/setting_3.webp"
                alt="Setting showcase 3"
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
            {(["All", "Realistic", "Unrealistic"] as const).map((cat) => (
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

        {/* SETTINGS GRID */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {filteredSettings.length > 0 ? (
            <div className="grid grid-cols-4 gap-4">
              {filteredSettings.map((setting) => {
                const isSelected = selectedSettingId === setting.id;
                return (
                  <button
                    key={setting.id}
                    onClick={() => handleSettingSelect(setting)}
                    className={`relative rounded-2xl overflow-hidden transition-all group cursor-pointer`}
                  >
                    {/* Video */}
                    <video
                      src={setting.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      disablePictureInPicture
                      className="w-full h-full object-cover"
                      style={{ aspectRatio: "9/16" }}
                      onMouseEnter={(e) => {
                        const video = e.currentTarget;
                        video.play().catch(() => {});
                      }}
                      onMouseLeave={(e) => {
                        const video = e.currentTarget;
                        video.pause();
                      }}
                    />

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col items-end justify-end p-3">
                      <p className="text-xs font-semibold text-white text-center w-full">
                        {setting.title}
                      </p>
                    </div>

                    {/* Action Icons */}
                    <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                      {/* Expand Icon */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors backdrop-blur-sm border border-white/20 cursor-pointer"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6v4m12 0h4v-4m0 12h-4v4m4-4h4v-4m-12 0v4m0-4H6"
                          />
                        </svg>
                      </div>

                      {/* Mute Icon */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors backdrop-blur-sm border border-white/20 cursor-pointer"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M13.5 4.06c0-1.336-1.616-2.256-2.73-1.72l-5.833 3.93A2 2 0 004 9.118v5.764a2 2 0 003.937 1.122l5.833 3.93c1.114.536 2.73-.384 2.73-1.72V4.06zM17.061 13.303l2.121 2.121a.75.75 0 111.06-1.06L18.121 12.242l2.121-2.121a.75.75 0 111.06-1.06L18.121 12.182l2.121-2.121a.75.75 0 111.06-1.06L18.121 12.182l2.121-2.121a.75.75 0 111.06-1.06L18.121 12.182" />
                        </svg>
                      </div>
                    </div>

                    {/* Selection Checkmark */}
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center ring-2 ring-cyan-400">
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
              <p className="text-white/50 text-sm">No settings found</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

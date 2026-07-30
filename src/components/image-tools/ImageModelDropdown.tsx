"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  Sparkles,
  Zap,
  Brain,
  Users,
  Smile,
  Shuffle,
  Maximize2,
  MessageSquare,
  Grid3x3,
  Aperture,
  Lightbulb,
  Palette,
} from "lucide-react";

const MODEL_ITEMS = [
  {
    id: "create-image",
    icon: Sparkles,
    title: "Create Image",
    description: "Generate images from text prompts",
    href: "/generate/image",
  },
  {
    id: "nano-banana-pro",
    icon: Zap,
    title: "Nano Banana Pro",
    description: "Start creating with Nano Banana Pro",
    href: "/generate/image?model=nano-banana-pro",
  },
  {
    id: "seedream-5-lite",
    icon: Brain,
    title: "Seedream 5.0 Lite",
    description: "Intelligent visual reasoning",
    href: "/generate/image?model=seedream-5-lite",
  },
  {
    id: "character-consistency",
    icon: Users,
    title: "Character Consistency",
    description: "Keep characters consistent across generations",
    href: "/generate/image/character-consistency",
  },
  {
    id: "face-swap",
    icon: Smile,
    title: "Face Swap",
    description: "Seamless face swapping",
    href: "/generate/image/face-swap",
  },
  {
    id: "character-swap",
    icon: Shuffle,
    title: "Character Swap",
    description: "Seamless character swapping",
    href: "/generate/image/character-swap",
  },
  {
    id: "upscale",
    icon: Maximize2,
    title: "Image Upscale",
    description: "Increase image resolution",
    href: "/generate/image/upscale",
  },
  {
    id: "image-prompt",
    icon: MessageSquare,
    title: "Image Prompt",
    description: "Generate prompts from uploaded images",
    href: "/generate/image/image-prompt",
  },
  {
    id: "multi-reference",
    icon: Grid3x3,
    title: "Multi Reference",
    description: "Multiple edits in one shot",
    href: "/generate/image/multi-reference",
  },
  {
    id: "gpt-image",
    icon: Aperture,
    title: "GPT Image",
    description: "Versatile text-to-image AI",
    href: "/generate/image?model=gpt-image",
  },
  {
    id: "flux-2-pro",
    icon: Lightbulb,
    title: "FLUX.2 Pro",
    description: "Speed-optimized detail",
    href: "/generate/image?model=flux-2-pro",
  },
  {
    id: "recraft-v4-1",
    icon: Palette,
    title: "Recraft V4.1",
    description: "Photorealistic and expressive image generation",
    href: "/generate/image?model=recraft-v4-1",
  },
];

interface ImageModelDropdownProps {
  selectedTool: string;
  onSelect: (toolId: string) => void;
}

export default function ImageModelDropdown({
  selectedTool,
  onSelect,
}: ImageModelDropdownProps) {
  const [search, setSearch] = useState("");

  const filteredItems = MODEL_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="absolute bottom-full right-0 z-50 mb-2 w-80 max-h-[400px] overflow-y-auto rounded-2xl border border-white/10 bg-black/95 backdrop-blur-3xl shadow-2xl">
      {/* Search input */}
      <div className="sticky top-0 border-b border-white/10 bg-black/95 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-magenta-500/50 focus:bg-white/10 focus:outline-none"
          />
        </div>
      </div>

      {/* Featured models section */}
      {!search && (
        <>
          <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500">
            Featured
          </div>
          {MODEL_ITEMS.slice(0, 3).map((item) => (
            <ModelRow
              key={item.id}
              item={item}
              isSelected={selectedTool === item.id}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {/* All models section */}
      {filteredItems.length > 0 && (
        <>
          <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500">
            {search ? "Results" : "All Models"}
          </div>
          {filteredItems.map((item) => (
            <ModelRow
              key={item.id}
              item={item}
              isSelected={selectedTool === item.id}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {filteredItems.length === 0 && search && (
        <div className="px-4 py-8 text-center text-xs text-zinc-500">
          No models found
        </div>
      )}
    </div>
  );
}

function ModelRow({
  item,
  isSelected,
  onSelect,
}: {
  item: (typeof MODEL_ITEMS)[0];
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={(e) => {
        e.preventDefault();
        onSelect(item.id);
      }}
      className={`flex items-start gap-3 border-b border-white/5 px-3 py-3 transition-colors hover:bg-white/5 ${
        isSelected ? "bg-white/10" : ""
      }`}
    >
      <div
        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
          isSelected ? "bg-magenta-500/20" : "bg-white/8"
        }`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-[18px] font-medium leading-6 text-white">{item.title}</h4>
        <p className="text-[10px] text-zinc-500">{item.description}</p>
      </div>
      {isSelected && (
        <div className="mt-1 h-2 w-2 rounded-full bg-magenta-500 shrink-0" />
      )}
    </Link>
  );
}

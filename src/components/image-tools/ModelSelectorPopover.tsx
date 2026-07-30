"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Search, Check } from "lucide-react";
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

const FEATURED_MODELS = [
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Google's flagship generation model",
    icon: Zap,
  },
  {
    id: "seedream-5-lite",
    name: "Seedream 5.0 Lite",
    description: "Intelligent visual reasoning",
    icon: Brain,
  },
  {
    id: "flux-2-pro",
    name: "FLUX.2 Pro",
    description: "Speed-optimized detail",
    icon: Lightbulb,
  },
];

const ALL_MODELS = [
  {
    id: "create-image",
    name: "Create Image",
    description: "Generate images from text prompts",
    icon: Sparkles,
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Google's flagship generation model",
    icon: Zap,
    badge: "Premium",
  },
  {
    id: "seedream-5-lite",
    name: "Seedream 5.0 Lite",
    description: "Intelligent visual reasoning",
    icon: Brain,
  },
  {
    id: "character-consistency",
    name: "Character Consistency",
    description: "Keep characters consistent",
    icon: Users,
  },
  {
    id: "face-swap",
    name: "Face Swap",
    description: "Seamless face swapping",
    icon: Smile,
  },
  {
    id: "character-swap",
    name: "Character Swap",
    description: "Seamless character swapping",
    icon: Shuffle,
  },
  {
    id: "upscale",
    name: "Image Upscale",
    description: "Increase image resolution",
    icon: Maximize2,
  },
  {
    id: "image-prompt",
    name: "Image Prompt",
    description: "Generate prompts from images",
    icon: MessageSquare,
  },
  {
    id: "multi-reference",
    name: "Multi Reference",
    description: "Multiple edits in one shot",
    icon: Grid3x3,
  },
  {
    id: "gpt-image",
    name: "GPT Image",
    description: "Versatile text-to-image AI",
    icon: Aperture,
    badge: "Premium",
  },
  {
    id: "flux-2-pro",
    name: "FLUX.2 Pro",
    description: "Speed-optimized detail",
    icon: Lightbulb,
  },
  {
    id: "recraft-v4-1",
    name: "Recraft V4.1",
    description: "Photorealistic image generation",
    icon: Palette,
    badge: "New",
  },
];

interface ModelSelectorPopoverProps {
  selectedModel: string;
  onClose: () => void;
}

export default function ModelSelectorPopover({
  selectedModel,
  onClose,
}: ModelSelectorPopoverProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filteredModels = ALL_MODELS.filter(
    (model) =>
      model.name.toLowerCase().includes(search.toLowerCase()) ||
      model.description.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectModel = (modelId: string) => {
    if (
      modelId === "character-consistency" ||
      modelId === "face-swap" ||
      modelId === "character-swap" ||
      modelId === "upscale" ||
      modelId === "image-prompt" ||
      modelId === "multi-reference"
    ) {
      router.push(`/generate/image/${modelId}`);
    } else if (modelId === "create-image") {
      router.push("/generate/image");
    } else {
      router.push(`/generate/image?model=${modelId}`);
    }
    onClose();
  };

  return (
    <Popover.Content
      side="top"
      align="start"
      sideOffset={8}
      collisionPadding={16}
      avoidCollisions={true}
      className="w-80 max-h-96 z-[100000] rounded-2xl border border-white/10 bg-black/95 backdrop-blur-3xl overflow-hidden flex flex-col shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2"
    >
      {/* Glow effects */}
      <div className="absolute top-0 left-0 w-full h-10 bg-gradient-to-b from-cyan-500/20 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 left-0 w-full h-10 bg-gradient-to-b from-cyan-500/20 to-transparent blur-3xl pointer-events-none" />

      {/* Search */}
      <div className="flex-shrink-0 border-b border-white/10 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            autoFocus
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/20 focus:bg-white/10"
          />
        </div>
      </div>

      {/* Models list */}
      <div className="flex-1 overflow-y-auto hide-scrollbar">
        {!search && (
          <>
            {/* Featured section */}
            <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500">
              Featured
            </div>
            {FEATURED_MODELS.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                isSelected={selectedModel === model.id}
                onSelect={handleSelectModel}
              />
            ))}
          </>
        )}

        {/* All models section */}
        {filteredModels.length > 0 && (
          <>
            <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500">
              {search ? "Results" : "All Models"}
            </div>
            {filteredModels.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                isSelected={selectedModel === model.id}
                onSelect={handleSelectModel}
              />
            ))}
          </>
        )}

        {filteredModels.length === 0 && search && (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">
            No models found
          </div>
        )}
      </div>
    </Popover.Content>
  );
}

function ModelRow({
  model,
  isSelected,
  onSelect,
}: {
  model: (typeof ALL_MODELS)[0];
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = model.icon;

  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`w-full flex items-start gap-3 px-3 py-2 border-b border-white/5 transition-colors hover:bg-white/5 ${
        isSelected ? "bg-white/5" : ""
      }`}
    >
      <div
        className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
          isSelected ? "bg-[#E61E8F]/20" : "bg-white/8"
        }`}
      >
        <Icon className={`h-6 w-6 ${isSelected ? "text-[#E61E8F]" : ""}`} />
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <h4 className="text-[18px] font-semibold leading-6 text-white">
            {model.name}
          </h4>
          {model.badge && (
            <span className="text-sm font-bold uppercase bg-[#E61E8F] text-white px-1.5 py-0.5 rounded-sm">
              {model.badge}
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500">{model.description}</p>
      </div>

      {isSelected && (
        <Check className="h-4 w-4 text-[#E61E8F] shrink-0 mt-1" />
      )}
    </button>
  );
}

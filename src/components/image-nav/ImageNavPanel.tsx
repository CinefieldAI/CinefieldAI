"use client";

import { usePathname, useSearchParams } from "next/navigation";
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
import NavPanelItem from "./NavPanelItem";

const IMAGE_ITEMS = [
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

interface ImageNavPanelProps {
  isOpen: boolean;
  onSelect?: (tool: string) => void;
}

export default function ImageNavPanel({ isOpen, onSelect }: ImageNavPanelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model");
  const isImageRoute =
    pathname === "/generate/image" || pathname.startsWith("/generate/image/");

  if (!isOpen) return null;

  return (
    <div
      className="pointer-events-auto absolute left-6 top-full z-50 mt-2 w-[600px] rounded-2xl border border-white/8 bg-black/95 p-4 backdrop-blur-3xl"
      style={{
        animation: "fadeInSlide 200ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
      }}
    >
      <style>{`
        @keyframes fadeInSlide {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <div className="grid grid-cols-2 gap-1">
        {IMAGE_ITEMS.map((item) => (
          <NavPanelItem
            key={item.id}
            icon={item.icon}
            title={item.title}
            description={item.description}
            href={item.href}
            toolId={item.id}
            onItemClick={onSelect}
            isActive={
              // For base /generate/image without query params
              item.href === "/generate/image"
                ? pathname === "/generate/image" && !modelParam
                : // For query param links like ?model=xyz
                item.href.includes("?model=")
                ? pathname === "/generate/image" &&
                  modelParam === item.href.split("?model=")[1]
                : // For sub-route links like /generate/image/face-swap
                pathname === item.href
            }
          />
        ))}
      </div>
    </div>
  );
}

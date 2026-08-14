"use client";

import {
  Clapperboard,
  Gem,
  Goal,
  LetterText,
  Sparkles,
  Video,
  WandSparkles,
  Waves,
  Zap,
} from "lucide-react";
import MarketingModelSelector, {
  type MarketingModelCategory,
  type MarketingModelOption,
} from "./MarketingModelSelector";

const featuredModels: MarketingModelOption[] = [
  {
    id: "marketing-studio-video",
    name: "Marketing Studio Video",
    description: "Model built for marketing video usecase",
    badges: ["NEW"],
    meta: ["720p-2K", "5s-30s"],
    icon: "/cinefield-logo.png",
  },
  {
    id: "seedance-2.5",
    name: "Seedance 2.5",
    description: "Exclusive access",
    badges: ["EXCLUSIVE ACCESS"],
    meta: ["1080p", "4s-30s"],
    icon: Waves,
  },
  {
    id: "seedance-2.5-edit",
    name: "Seedance 2.5 Edit",
    description: "Edit video with audio",
    badges: ["NEW"],
    meta: ["480p-720p", "Edit Video", "Audio"],
    sound: true,
    icon: Waves,
  },
  {
    id: "seedance-2.0",
    name: "Seedance 2.0",
    description: "Cinematic multi-shot video creation",
    meta: ["4K", "4s-15s"],
    icon: Waves,
  },
  {
    id: "seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    description: "Fast cinematic video creation",
    meta: ["720p", "4s-15s"],
    icon: Waves,
  },
  {
    id: "seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    description: "Lightweight cinematic video creation",
    meta: ["720p", "4s-15s"],
    icon: Waves,
  },
  {
    id: "minimax-h3",
    name: "MiniMax H3",
    description: "High-dynamic, VFX-ready, fastest and most affordable",
    badges: ["NEW"],
    meta: ["2K", "5s-15s"],
    icon: Zap,
  },
  {
    id: "gemini-omni-flash",
    name: "Gemini Omni Flash",
    description: "Fast video generation",
    meta: ["720p", "4s-10s"],
    icon: Goal,
  },
  {
    id: "kling-3.0",
    name: "Kling 3.0",
    description: "Perfect motion with advanced video control",
    meta: ["4K", "3s-15s"],
    icon: WandSparkles,
  },
  {
    id: "kling-3.0-motion-control",
    name: "Kling 3.0 Motion Control",
    description: "Advanced motion control",
    meta: ["1080p", "3s-30s"],
    icon: WandSparkles,
  },
  {
    id: "flux-3-video-featured",
    name: "FLUX.3 Video",
    description: "Expressive image-to-video generation",
    badges: ["NEW"],
    meta: ["1080p", "5s-20s"],
    icon: Gem,
  },
  {
    id: "grok-imagine-1.5",
    name: "Grok Imagine 1.5",
    description: "Perfect motion with advanced video control",
    meta: ["720p", "1s-15s"],
    icon: Sparkles,
  },
];

const allModels: MarketingModelOption[] = [
  {
    id: "minimax-hailuo",
    name: "Minimax Hailuo",
    description: "High-dynamic, VFX-ready, fastest and most affordable",
    icon: Zap,
    submodels: [
      { id: "minimax-h3-sub", name: "MiniMax H3", description: "High-dynamic and VFX-ready", badges: ["NEW"], meta: ["2K", "5s-15s"], icon: Zap },
      { id: "minimax-hailuo-02", name: "Minimax Hailuo 02", description: "Fast and affordable video generation", meta: ["1080p", "5s-10s"], icon: Zap },
    ],
  },
  {
    id: "flux-3-video",
    name: "FLUX.3 Video",
    description: "Expressive image-to-video generation",
    badges: ["NEW"],
    meta: ["1080p", "5s-20s"],
    icon: Gem,
  },
  {
    id: "kling",
    name: "Kling",
    description: "Perfect motion with advanced video control",
    icon: WandSparkles,
    submodels: [
      { id: "kling-3.0-sub", name: "Kling 3.0", description: "Perfect motion with advanced video control", meta: ["4K", "3s-15s"], icon: WandSparkles },
      { id: "kling-3.0-motion-sub", name: "Kling 3.0 Motion Control", description: "Advanced motion control", meta: ["1080p", "3s-30s"], icon: WandSparkles },
      { id: "kling-2.6", name: "Kling 2.6", description: "Reliable video generation", meta: ["1080p", "5s-10s"], icon: WandSparkles },
    ],
  },
  {
    id: "openai-sora-2",
    name: "OpenAI Sora 2",
    description: "Multi-shot video with sound generation",
    sound: true,
    icon: LetterText,
    submodels: [
      { id: "sora-2", name: "Sora 2", description: "Multi-shot video with sound generation", meta: ["720p", "4s-12s"], sound: true, icon: LetterText },
      { id: "sora-2-pro", name: "Sora 2 Pro", description: "Higher quality multi-shot generation", meta: ["1080p", "4s-12s"], sound: true, icon: LetterText },
    ],
  },
  {
    id: "google-veo",
    name: "Google Veo",
    description: "Precision video with sound control",
    sound: true,
    icon: Goal,
    submodels: [
      { id: "veo-3.1", name: "Veo 3.1", description: "Precision video with sound control", meta: ["1080p", "4s-8s"], sound: true, icon: Goal },
      { id: "veo-3.1-fast", name: "Veo 3.1 Fast", description: "Faster precision video generation", meta: ["720p", "4s-8s"], sound: true, icon: Goal },
    ],
  },
  {
    id: "gemini-omni-flash-all",
    name: "Gemini Omni Flash",
    description: "Fast video generation",
    meta: ["720p", "4s-10s"],
    icon: Goal,
  },
  {
    id: "higgsfield",
    name: "Cinefield",
    description: "Advanced camera controls and effect presets",
    icon: "/cinefield-logo.png",
    submodels: [
      { id: "cinefield-lite", name: "Cinefield Lite", description: "Fast Cinefield motion preset", meta: ["720p", "3s-5s"], icon: "/cinefield-logo.png" },
      { id: "cinefield-standard", name: "Cinefield Standard", description: "Balanced Cinefield motion preset", meta: ["720p", "3s-5s"], icon: "/cinefield-logo.png" },
      { id: "cinefield-turbo", name: "Cinefield Turbo", description: "Fast Cinefield rendering preset", meta: ["720p", "3s-5s"], icon: "/cinefield-logo.png" },
    ],
  },
  {
    id: "wan",
    name: "Wan",
    description: "Camera-controlled video with sound, more freedom",
    sound: true,
    icon: Video,
    submodels: [
      { id: "wan-2.2", name: "Wan 2.2", description: "Camera-controlled video with sound", meta: ["720p", "5s"], sound: true, icon: Video },
      { id: "wan-2.2-fast", name: "Wan 2.2 Fast", description: "Faster camera-controlled video", meta: ["720p", "5s"], sound: true, icon: Video },
    ],
  },
  {
    id: "seedance",
    name: "Seedance",
    description: "Cinematic, multi-shot video creation",
    icon: Waves,
    submodels: featuredModels.filter((model) => model.id.startsWith("seedance")),
  },
  {
    id: "grok-imagine",
    name: "Grok Imagine",
    description: "Perfect motion with advanced video control",
    icon: Sparkles,
    submodels: [
      { id: "grok-imagine-1.5-sub", name: "Grok Imagine 1.5", description: "Perfect motion with advanced video control", meta: ["720p", "1s-15s"], icon: Sparkles },
    ],
  },
  {
    id: "happyhorse",
    name: "HappyHorse",
    description: "Stylized video generation",
    meta: ["1080p", "3s-15s"],
    icon: Clapperboard,
  },
];

const VIDEO_MODEL_CATEGORIES: MarketingModelCategory[] = [
  { label: "Featured models", models: featuredModels },
  { label: "All models", models: allModels },
];

const FALLBACK_MODEL = featuredModels[0];

export default function MarketingVideoModelSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <MarketingModelSelector
      ariaLabel="Marketing Studio video models"
      selected={selected}
      fallback={FALLBACK_MODEL}
      categories={VIDEO_MODEL_CATEGORIES}
      onSelect={onSelect}
      triggerMinWidth="186px"
    />
  );
}

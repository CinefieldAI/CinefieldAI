import React from "react";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";

export interface CreateImageModel {
  id: string;
  name: string;
  description: string;
  badge?: "TOP" | "NEW" | "PREMIUM";
  /** Optional custom icon component or public image path. */
  icon?: React.ComponentType<{ className?: string }> | string;
  newlyAdded?: boolean;
}

const getIcon = (name: string, fallback?: React.ComponentType<{ className?: string }>) =>
  getSharedModelIcon(name) ?? fallback;

export const MASTER_IMAGE_MODELS: Record<string, CreateImageModel> = {
  auto: {
    id: "auto",
    name: "Auto",
    description: "Automatically pick the best model for your prompt",
    icon: getIcon("Auto")!,
  },
  "higgsfield-soul-2": {
    id: "higgsfield-soul-2",
    name: "Higgsfield Soul 2.0",
    description: "Photoreal portrait engine",
    badge: "TOP",
    icon: getIcon("Higgsfield Soul 2.0")!,
  },
  "higgsfield-soul-cinema": {
    id: "higgsfield-soul-cinema",
    name: "Higgsfield Soul Cinema",
    description: "Cinematic character stills",
    icon: getIcon("Higgsfield Soul Cinema")!,
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    name: "GPT Image 2",
    description: "4K images with near-perfect text rendering",
    badge: "NEW",
    icon: getIcon("GPT Image 2")!,
  },
  "seedream-5-pro": {
    id: "seedream-5-pro",
    name: "Seedream 5.0 Pro",
    description: "Logically consistent images with intelligent visual reasoning",
    badge: "NEW",
    newlyAdded: true,
    icon: getIcon("Seedream 5.0 Pro")!,
  },
  "seedream-5-lite": {
    id: "seedream-5-lite",
    name: "Seedream 5.0 Lite",
    description: "Intelligent visual reasoning",
    icon: getIcon("Seedream 5.0 Lite")!,
  },
  "seedream-4-5": {
    id: "seedream-4-5",
    name: "Seedream 4.5",
    description: "Balanced quality & speed",
    badge: "PREMIUM",
    newlyAdded: true,
    icon: getIcon("Seedream 4.5")!,
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Google's flagship generation model",
    icon: getIcon("Nano Banana Pro")!,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    description: "Fast iteration drafts",
    badge: "PREMIUM",
    icon: getIcon("Nano Banana 2")!,
  },
  "nano-banana-2-lite": {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    description: "Lightweight generation at speed",
    badge: "NEW",
    newlyAdded: true,
    icon: getIcon("Nano Banana 2 Lite")!,
  },
  "recraft-v4-1": {
    id: "recraft-v4-1",
    name: "Recraft V4.1",
    description: "Photorealistic and expressive image generation",
    badge: "NEW",
    icon: getIcon("Recraft V4.1")!,
  },
  "wan-2-2": {
    id: "wan-2-2",
    name: "WAN 2.2",
    description: "High-fidelity cinematic visuals",
    icon: getIcon("WAN 2.2")!,
  },
  "nano-banana": {
    id: "nano-banana",
    name: "Nano Banana",
    description: "Quick stylized drafts",
    icon: getIcon("Nano Banana")!,
  },
  "higgsfield-soul": {
    id: "higgsfield-soul",
    name: "Higgsfield Soul",
    description: "Original portrait engine",
    icon: getIcon("Higgsfield Soul")!,
  },
  "higgsfield-face-swap": {
    id: "higgsfield-face-swap",
    name: "Higgsfield Face Swap",
    description: "Transfer a face across any image",
    icon: getIcon("Higgsfield Face Swap")!,
  },
  "higgsfield-character-swap": {
    id: "higgsfield-character-swap",
    name: "Higgsfield Character Swap",
    description: "Replace a full subject seamlessly",
    icon: getIcon("Higgsfield Character Swap")!,
  },
  "seedream-4-0": {
    id: "seedream-4-0",
    name: "Seedream 4.0",
    description: "Lightweight diffusion",
    icon: getIcon("Seedream 4.0")!,
  },
  "gpt-image-1-5": {
    id: "gpt-image-1-5",
    name: "GPT Image 1.5",
    description: "OpenAI · balanced quality",
    icon: getIcon("GPT Image 1.5")!,
  },
  "grok-imagine": {
    id: "grok-imagine",
    name: "Grok Imagine",
    description: "Versatile image styles by xAI",
    badge: "PREMIUM",
    icon: getIcon("Grok Imagine")!,
  },
  "recraft-v4-1-utility": {
    id: "recraft-v4-1-utility",
    name: "Recraft V4.1 Utility",
    description: "Icon & asset generation",
    icon: getIcon("Recraft V4.1 Utility")!,
  },
  "z-image": {
    id: "z-image",
    name: "Z-Image",
    description: "Instant lifelike portraits",
    icon: getIcon("Z-Image")!,
  },
  "kling-o1": {
    id: "kling-o1",
    name: "Kling O1",
    description: "Kling's Photorealistic Image Model",
    badge: "PREMIUM",
    icon: getIcon("Kling O1")!,
  },
  "flux-2-pro": {
    id: "flux-2-pro",
    name: "FLUX.2 Pro",
    description: "Speed-optimized detail",
    icon: getIcon("FLUX.2 Pro")!,
  },
  "flux-2-flex": {
    id: "flux-2-flex",
    name: "FLUX.2 Flex",
    description: "Flexible aspect & control",
    icon: getIcon("FLUX.2 Flex")!,
  },
  "flux-2-max": {
    id: "flux-2-max",
    name: "FLUX.2 Max",
    description: "Maximum fidelity render",
    icon: getIcon("FLUX.2 Max")!,
  },
  "flux-kontext-max": {
    id: "flux-kontext-max",
    name: "Flux Kontext Max",
    description: "Context-aware editing",
    icon: getIcon("Flux Kontext Max")!,
  },
  "gpt-image": {
    id: "gpt-image",
    name: "GPT Image",
    description: "OpenAI · general purpose",
    icon: getIcon("GPT Image")!,
  },
  "multi-reference": {
    id: "multi-reference",
    name: "Multi Reference",
    description: "Blend multiple reference images",
    icon: getIcon("Multi Reference")!,
  },
};

export const FEATURED_MODEL_IDS = [
  "higgsfield-soul-2",
  "higgsfield-soul-cinema",
  "gpt-image-2",
  "seedream-5-pro",
  "seedream-5-lite",
  "seedream-4-5",
  "nano-banana-pro",
  "nano-banana-2",
  "nano-banana-2-lite",
  "recraft-v4-1",
  "wan-2-2",
];

export const ALL_MODEL_IDS = [
  "nano-banana",
  "higgsfield-soul",
  "higgsfield-face-swap",
  "higgsfield-character-swap",
  "seedream-4-0",
  "gpt-image-1-5",
  "grok-imagine",
  "recraft-v4-1",
  "recraft-v4-1-utility",
  "z-image",
  "kling-o1",
  "flux-2-pro",
  "flux-2-flex",
  "flux-2-max",
  "flux-kontext-max",
  "gpt-image",
  "multi-reference",
  "wan-2-2",
];

export const FEATURED_MODELS: CreateImageModel[] = FEATURED_MODEL_IDS.map(
  (id) => MASTER_IMAGE_MODELS[id],
);

export const ALL_MODELS: CreateImageModel[] = ALL_MODEL_IDS.map(
  (id) => MASTER_IMAGE_MODELS[id],
);

export interface AspectRatioOption {
  label: string;
  value: string;
  description: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { label: "Square", value: "1:1", description: "1:1", width: 16, height: 16 },
  { label: "Portrait", value: "3:4", description: "3:4", width: 15, height: 20 },
  { label: "Landscape", value: "4:3", description: "4:3", width: 20, height: 15 },
  { label: "Portrait", value: "4:5", description: "4:5", width: 16, height: 20 },
  { label: "Landscape", value: "5:4", description: "5:4", width: 20, height: 16 },
  { label: "Landscape", value: "3:2", description: "3:2", width: 21, height: 14 },
  { label: "Portrait", value: "2:3", description: "2:3", width: 14, height: 21 },
  { label: "Cinematic", value: "16:9", description: "16:9", width: 21, height: 12 },
  { label: "Tall", value: "9:16", description: "9:16", width: 12, height: 21 },
];

export const QUALITY_PRESETS = ["Draft", "Standard", "High"] as const;
export const IMAGE_SIZES = ["512", "768", "1024", "1536", "2048"] as const;
export const OUTPUT_COUNTS = [1, 2, 3, 4] as const;

export interface ReferenceAttachment {
  id: string;
  url: string;
  name: string;
  loading: boolean;
}

export interface GeneratedResult {
  id: string;
  prompt: string;
  gradient: string;
}

export const SAMPLE_RESULTS: GeneratedResult[] = [
  { id: "r1", prompt: "Editorial portrait, soft studio light", gradient: "from-rose-500/35 via-pink-600/25 to-black" },
  { id: "r2", prompt: "Neon cyberpunk alley, rain reflections", gradient: "from-sky-500/35 via-indigo-600/25 to-black" },
  { id: "r3", prompt: "Product render on marble pedestal", gradient: "from-amber-500/35 via-orange-600/25 to-black" },
  { id: "r4", prompt: "Fantasy landscape at golden hour", gradient: "from-emerald-500/35 via-teal-600/25 to-black" },
  { id: "r5", prompt: "Minimal architectural interior", gradient: "from-violet-500/35 via-purple-600/25 to-black" },
  { id: "r6", prompt: "Anime key visual, dramatic lighting", gradient: "from-cyan-500/35 via-sky-600/25 to-black" },
  { id: "r7", prompt: "Retro film still, grainy texture", gradient: "from-lime-500/35 via-green-600/25 to-black" },
  { id: "r8", prompt: "Editorial fashion, bold color block", gradient: "from-fuchsia-500/35 via-magenta-600/25 to-black" },
];

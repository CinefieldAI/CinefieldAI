"use client";

import { Sparkles } from "lucide-react";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";
import MarketingModelSelector, {
  type MarketingModelCategory,
  type MarketingModelOption,
} from "./MarketingModelSelector";

function MarketingGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M5 17.5 16.5 6M8.5 6H18v9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M6 18h4v2H6zM14 4h4v4h-4z" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function withIcon(model: Omit<MarketingModelOption, "icon">): MarketingModelOption {
  const icon =
    model.name === "Marketing Studio Image"
      ? MarketingGlyph
      : model.name === "Grok Imagine 2.0"
        ? getSharedModelIcon("Grok Imagine")
        : model.name === "FLUX.2 MAX"
          ? getSharedModelIcon("FLUX.2 Max")
          : getSharedModelIcon(model.name);

  return { ...model, icon: icon ?? Sparkles };
}

const FEATURED_MODELS: MarketingModelOption[] = [
  withIcon({ id: "marketing-studio-image", name: "Marketing Studio Image", description: "Model built for marketing usecase" }),
  withIcon({ id: "higgsfield-soul-2", name: "Cinefield Soul 2.0", description: "Next generation ultra-realistic fashion visuals" }),
  withIcon({ id: "higgsfield-soul-cinema", name: "Cinefield Soul Cinema", description: "Cinema-grade visual creation" }),
  withIcon({ id: "gpt-image-2", name: "GPT Image 2", description: "4K images with near-perfect text rendering" }),
  withIcon({ id: "seedream-5-pro", name: "Seedream 5.0 Pro", description: "Logically consistent images with intelligent visual reasoning" }),
  withIcon({ id: "seedream-5-lite", name: "Seedream 5.0 lite", description: "Intelligent visual reasoning", badges: ["UNLIMITED PAUSED"] }),
  withIcon({ id: "seedream-4-5", name: "Seedream 4.5", description: "ByteDance's next-gen 4K image-editing model" }),
  withIcon({ id: "nano-banana-pro", name: "Nano Banana Pro", description: "Google's flagship generation model" }),
  withIcon({ id: "nano-banana-2", name: "Nano Banana 2", description: "Pro quality at Flash speed" }),
  withIcon({ id: "nano-banana-2-lite", name: "Nano Banana 2 Lite", description: "Lightweight image generation at speed" }),
  withIcon({ id: "recraft-v4-1", name: "Recraft V4.1", description: "Photorealistic and expressive image generation" }),
];

const ALL_MODELS: MarketingModelOption[] = [
  withIcon({ id: "auto", name: "Auto", description: "The best model for any prompt, chosen for you" }),
  withIcon({ id: "higgsfield-soul", name: "Cinefield Soul", description: "Ultra-realistic fashion visuals" }),
  withIcon({ id: "higgsfield-soul-2", name: "Cinefield Soul 2.0", description: "Next generation ultra-realistic fashion visuals" }),
  withIcon({ id: "higgsfield-soul-cinema", name: "Cinefield Soul Cinema", description: "Cinema-grade visual creation" }),
  withIcon({ id: "gpt-image-2", name: "GPT Image 2", description: "4K images with near-perfect text rendering" }),
  withIcon({ id: "gpt-image-1-5", name: "GPT Image 1.5", description: "True-color precision rendering" }),
  withIcon({ id: "gpt-image", name: "GPT Image", description: "Versatile text-to-image AI" }),
  withIcon({ id: "marketing-studio-image", name: "Marketing Studio Image", description: "Model built for marketing usecase" }),
  withIcon({ id: "nano-banana-pro", name: "Nano Banana Pro", description: "Google's flagship generation model" }),
  withIcon({ id: "nano-banana-2", name: "Nano Banana 2", description: "Pro quality at Flash speed" }),
  withIcon({ id: "nano-banana-2-lite", name: "Nano Banana 2 Lite", description: "Lightweight image generation at speed" }),
  withIcon({ id: "nano-banana", name: "Nano Banana", description: "Google's standard generation model" }),
  withIcon({ id: "seedream-5-pro", name: "Seedream 5.0 Pro", description: "Logically consistent images with intelligent visual reasoning" }),
  withIcon({ id: "seedream-5-lite", name: "Seedream 5.0 lite", description: "Intelligent visual reasoning", badges: ["UNLIMITED PAUSED"] }),
  withIcon({ id: "seedream-4-5", name: "Seedream 4.5", description: "ByteDance's next-gen 4K image-editing model" }),
  withIcon({ id: "seedream-4-0", name: "Seedream 4.0", description: "ByteDance's advanced image editing model" }),
  withIcon({ id: "grok-imagine", name: "Grok Imagine", description: "Versatile image styles by xAI" }),
  withIcon({ id: "grok-imagine-2", name: "Grok Imagine 2.0", description: "High-resolution image generation by xAI" }),
  withIcon({ id: "recraft-v4-1", name: "Recraft V4.1", description: "Photorealistic and expressive image generation" }),
  withIcon({ id: "recraft-v4-1-utility", name: "Recraft V4.1 Utility", description: "Simple scenes with flat, even lighting" }),
  withIcon({ id: "z-image", name: "Z-Image", description: "Instant lifelike portraits" }),
  withIcon({ id: "kling-o1", name: "Kling O1", description: "Kling's Photorealistic Image Model" }),
  withIcon({ id: "flux-2-pro", name: "FLUX.2 Pro", description: "Speed-optimized detail", badges: ["UNLIMITED PAUSED"] }),
  withIcon({ id: "flux-2-flex", name: "FLUX.2 Flex", description: "Edit with accuracy" }),
  withIcon({ id: "flux-2-max", name: "FLUX.2 MAX", description: "Sharp text, maximum detail" }),
  withIcon({ id: "flux-kontext-max", name: "Flux Kontext Max", description: "Edit with accuracy" }),
  withIcon({ id: "multi-reference", name: "Multi Reference", description: "Multiple edits in one shot" }),
  withIcon({ id: "wan-2-2", name: "WAN 2.2", description: "High-fidelity cinematic visuals" }),
];

const CATEGORY_SOURCES: MarketingModelCategory[] = [
  { label: "Featured models", models: FEATURED_MODELS },
  { label: "All models", models: ALL_MODELS },
];

export default function MarketingImageModelSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <MarketingModelSelector
      ariaLabel="Marketing Studio image models"
      selected={selected}
      fallback={FEATURED_MODELS[7]}
      categories={CATEGORY_SOURCES}
      onSelect={onSelect}
    />
  );
}

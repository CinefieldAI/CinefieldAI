import {
  Eraser,
  Fingerprint,
  ImageIcon,
  Images,
  LayoutGrid,
  LayoutTemplate,
  Lightbulb,
  Maximize2,
  PenLine,
  Repeat,
  Shirt,
  Shuffle,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { ElementType } from "react";
import {
  FluxIcon,
  GoogleIcon,
  GrokIcon,
  KlingIcon,
  MultiReferenceIcon,
  OpenAIIcon,
  RecraftIcon,
  SeedreamIcon,
  TopazIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";

export type ImageFeatureKey =
  | "create"
  | "cameras"
  | "canvas"
  | "moodboard"
  | "character"
  | "influencer"
  | "photodump"
  | "relight"
  | "inpaint"
  | "upscale"
  | "faceswap"
  | "characterswap"
  | "draw"
  | "fashion";

export interface ImageFeature {
  key: ImageFeatureKey;
  title: string;
  description: string;
  icon: LucideIcon;
  badge?: "New" | "Pro";
}

export const IMAGE_FEATURES: ImageFeature[] = [
  {
    key: "create",
    title: "Create Image",
    description: "Generate from a single text prompt",
    icon: ImageIcon,
  },
  {
    key: "cameras",
    title: "Cinematic Cameras",
    description: "Frame shots with director-grade lensing",
    icon: Video,
    badge: "Pro",
  },
  {
    key: "canvas",
    title: "Canvas",
    description: "Open the freeform creative workspace",
    icon: LayoutTemplate,
    badge: "New",
  },
  {
    key: "moodboard",
    title: "Moodboard",
    description: "Collect references into a visual brief",
    icon: LayoutGrid,
    badge: "New",
  },
  {
    key: "character",
    title: "Soul ID Character",
    description: "Lock a consistent identity across shots",
    icon: Fingerprint,
    badge: "New",
  },
  {
    key: "influencer",
    title: "AI Influencer",
    description: "Build a persistent virtual persona",
    icon: Users,
  },
  {
    key: "photodump",
    title: "Photodump",
    description: "Batch-generate a themed photo set",
    icon: Images,
  },
  {
    key: "relight",
    title: "Relight",
    description: "Re-light a scene with new sources",
    icon: Lightbulb,
    badge: "Pro",
  },
  {
    key: "inpaint",
    title: "Inpaint",
    description: "Remove or replace any region",
    icon: Eraser,
  },
  {
    key: "upscale",
    title: "Image Upscale",
    description: "Enhance resolution without artifacts",
    icon: Maximize2,
  },
  {
    key: "faceswap",
    title: "Face Swap",
    description: "Transfer a face across any image",
    icon: Repeat,
  },
  {
    key: "characterswap",
    title: "Character Swap",
    description: "Replace a full subject seamlessly",
    icon: Shuffle,
  },
  {
    key: "draw",
    title: "Draw to Edit",
    description: "Sketch a region to guide the edit",
    icon: PenLine,
  },
  {
    key: "fashion",
    title: "Fashion Factory",
    description: "Generate apparel try-ons at scale",
    icon: Shirt,
    badge: "New",
  },
];

export interface ImageModel {
  name: string;
  meta: string;
  icon: ElementType | string;
  isAdded?: boolean;
}

export const FEATURED_DROPDOWN_MODELS: ImageModel[] = [
  {
    name: "Higgsfield Soul 2.0",
    meta: "Next generation ultra-realistic fashion visuals",
    icon: Sparkles,
  },
  {
    name: "Higgsfield Soul Cinema",
    meta: "Cinema-grade visual creation",
    icon: Sparkles,
  },
  {
    name: "GPT Image 2",
    meta: "4K images with near-perfect text rendering",
    icon: OpenAIIcon,
  },
  {
    name: "Seedream 5.0 Pro",
    meta: "Logically consistent images with intelligent visual reasoning",
    icon: SeedreamIcon,
    isAdded: true,
  },
  {
    name: "Seedream 5.0 lite",
    meta: "Intelligent visual reasoning",
    icon: SeedreamIcon,
  },
  {
    name: "Seedream 4.5",
    meta: "ByteDance's next-gen 4K image model",
    icon: SeedreamIcon,
    isAdded: true,
  },
  {
    name: "Nano Banana Pro",
    meta: "Google's flagship generation model",
    icon: GoogleIcon,
  },
  {
    name: "Nano Banana 2",
    meta: "Pro quality at Flash speed",
    icon: GoogleIcon,
  },
  {
    name: "Nano Banana 2 Lite",
    meta: "Lightweight image generation at speed",
    icon: GoogleIcon,
    isAdded: true,
  },
  {
    name: "Recraft V4.1",
    meta: "Photorealistic and expressive image generation",
    icon: RecraftIcon,
  },
];

export const ALL_DROPDOWN_MODELS: ImageModel[] = [
  {
    name: "Nano Banana",
    meta: "Google's standard generation model",
    icon: GoogleIcon,
    isAdded: true,
  },
  {
    name: "Higgsfield Soul",
    meta: "Ultra-realistic fashion visuals",
    icon: Sparkles,
    isAdded: true,
  },
  {
    name: "Higgsfield Face Swap",
    meta: "Seamless face swapping",
    icon: Sparkles,
    isAdded: true,
  },
  {
    name: "Higgsfield Character Swap",
    meta: "Seamless character swapping",
    icon: Sparkles,
    isAdded: true,
  },
  {
    name: "Seedream 4.0",
    meta: "ByteDance's advanced image editing model",
    icon: SeedreamIcon,
    isAdded: true,
  },
  {
    name: "GPT Image 1.5",
    meta: "True-color precision rendering",
    icon: OpenAIIcon,
  },
  {
    name: "Grok Imagine",
    meta: "Versatile image styles by xAI",
    icon: GrokIcon,
  },
  {
    name: "Recraft V4.1",
    meta: "Photorealistic and expressive image generation",
    icon: RecraftIcon,
  },
  {
    name: "Recraft V4.1 Utility",
    meta: "Simple scenes with flat, even lighting",
    icon: RecraftIcon,
    isAdded: true,
  },
  {
    name: "Z-Image",
    meta: "Instant lifelike portraits",
    icon: WanIcon,
  },
  {
    name: "Kling O1",
    meta: "Kling's Photorealistic Image Model",
    icon: KlingIcon,
    isAdded: true,
  },
  {
    name: "FLUX.2 Pro",
    meta: "Speed-optimized detail",
    icon: FluxIcon,
    isAdded: true,
  },
  {
    name: "FLUX.2 Flex",
    meta: "Next-gen image generation",
    icon: FluxIcon,
    isAdded: true,
  },
  {
    name: "FLUX.2 Max",
    meta: "Ultimate precision and speed",
    icon: FluxIcon,
    isAdded: true,
  },
  {
    name: "Flux Kontext Max",
    meta: "Edit with accuracy",
    icon: FluxIcon,
    isAdded: true,
  },
  {
    name: "GPT Image",
    meta: "Versatile text-to-image AI",
    icon: OpenAIIcon,
    isAdded: true,
  },
  {
    name: "Multi Reference",
    meta: "Multiple edits in one shot",
    icon: MultiReferenceIcon,
    isAdded: true,
  },
  {
    name: "WAN 2.2",
    meta: "High-fidelity cinematic visuals",
    icon: WanIcon,
    isAdded: true,
  },
  {
    name: "Topaz",
    meta: "Upscale & restoration",
    icon: TopazIcon,
  },
  {
    name: "Higgsfield Popcorn",
    meta: "Fun, stylized quick-gen",
    icon: Sparkles,
  },
];

export const IMAGE_DROPDOWN_MODELS: ImageModel[] = [
  ...FEATURED_DROPDOWN_MODELS,
  ...ALL_DROPDOWN_MODELS,
];

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

// Single unified models list (matches the higgsfield.ai reference: one
// "Models" column, no Featured/All split). Trimmed down from the earlier
// expanded catalog to the reference's 15 models — see imageDropdownData
// git history for the removed extras (Seedream 4.0/4.5, base Nano
// Banana/Higgsfield Soul, Face/Character Swap, Recraft V4.1 Utility,
// Kling O1, FLUX.2 Flex/Max, Flux Kontext Max, base GPT Image, Multi
// Reference, WAN 2.2) if any of those need to come back.
export const IMAGE_DROPDOWN_MODELS: ImageModel[] = [
  {
    name: "🚫 Cinefield Soul 2.0",
    meta: "Next generation ultra-realistic fashion visuals",
    icon: Sparkles,
  },
  {
    name: "🚫 Cinefield Soul Cinema",
    meta: "Cinema-grade visual creation",
    icon: Sparkles,
  },
  {
    name: "🚫 Cinefield Popcorn",
    meta: "Fun, stylized quick-gen",
    icon: Sparkles,
  },
  {
    name: "GPT Image 2",
    meta: "4K images with near-perfect text rendering",
    icon: OpenAIIcon,
  },
  {
    name: "GPT Image 1.5",
    meta: "True-color precision rendering",
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
    name: "Nano Banana Pro",
    meta: "Google's flagship generation model",
    icon: GoogleIcon,
  },
  {
    name: "Recraft V4.1",
    meta: "Photorealistic and expressive image generation",
    icon: RecraftIcon,
  },
  {
    name: "Grok Imagine",
    meta: "Versatile image styles by xAI",
    icon: GrokIcon,
  },
  {
    name: "FLUX.2 Pro",
    meta: "Speed-optimized detail",
    icon: FluxIcon,
    isAdded: true,
  },
  {
    name: "Z-Image",
    meta: "Instant lifelike portraits",
    icon: WanIcon,
  },
  {
    name: "Topaz",
    meta: "Upscale & restoration",
    icon: TopazIcon,
  },
];

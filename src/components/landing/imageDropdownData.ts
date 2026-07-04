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
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

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
  /** Optional custom icon image (public path). Falls back to the name initial. */
  icon?: string;
}

export const IMAGE_DROPDOWN_MODELS: ImageModel[] = [
  { name: "Higgsfield Soul 2.0", meta: "Photoreal portrait engine" },
  { name: "Higgsfield Soul Cinema", meta: "Cinematic character stills" },
  { name: "Higgsfield Popcorn", meta: "Fun, stylized quick-gen" },
  { name: "GPT Image 2", meta: "OpenAI · general purpose" },
  { name: "Recraft V4.1", meta: "Vector & raster design" },
  { name: "Nano Banana 2", meta: "Fast iteration drafts" },
  {
    name: "Nano Banana Pro",
    meta: "High-fidelity drafts",
    icon: "/de397d3b-0644-47ac-a4fe-49d64ede48d3.png",
  },
  { name: "Seedream 5.0 lite", meta: "Lightweight diffusion" },
  { name: "GPT Image 1.5", meta: "OpenAI · balanced quality" },
  { name: "Grok Imagine", meta: "xAI · expressive generation" },
  { name: "FLUX.2", meta: "Black Forest Labs · photoreal" },
  { name: "Reve", meta: "Editorial-grade rendering" },
  { name: "Z-Image", meta: "Compact high-speed model" },
  { name: "Topaz", meta: "Upscale & restoration" },
];

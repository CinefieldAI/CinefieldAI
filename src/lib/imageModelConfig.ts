export interface ImageModelConfig {
  id: string;
  label: string;
  description: string;
  icon: string;
  qualityOptions: string[];
  qualityDescriptions?: Record<string, string>;
  premiumQualityOptions?: string[];
  defaultQuality: string;
  aspectRatioOptions: string[];
  defaultAspectRatio: string;
  showUpload: boolean;
  showDraw: boolean;
  defaultCount: number;
  maxCount: number;
  generateCredits: number;
  badge?: string;
}

const DEFAULT_CONFIG: ImageModelConfig = {
  id: "",
  label: "",
  description: "",
  icon: "google",
  qualityOptions: ["1K", "2K", "4K"],
  defaultQuality: "1K",
  aspectRatioOptions: ["Auto", "1:1", "3:4", "4:3", "16:9"],
  defaultAspectRatio: "4:3",
  showUpload: true,
  showDraw: false,
  defaultCount: 1,
  maxCount: 4,
  generateCredits: 2,
};

export const IMAGE_MODEL_CONFIGS: Record<string, ImageModelConfig> = {
  "gpt-image-2": {
    id: "gpt-image-2",
    label: "GPT Image 2",
    description: "4K images with near-perfect text rendering",
    icon: "openai",
    qualityOptions: ["Low", "Medium", "High"],
    qualityDescriptions: {
      Low: "Fastest and cheapest",
      Medium: "Balanced visuals",
      High: "Best visual fidelity",
    },
    defaultQuality: "Low",
    aspectRatioOptions: ["Auto", "1:1", "3:4", "4:3", "16:9"],
    defaultAspectRatio: "Auto",
    showUpload: false,
    showDraw: false,
    defaultCount: 2,
    maxCount: 4,
    generateCredits: 2.25,
  },
  "seedream-4-5": {
    id: "seedream-4-5",
    label: "Seedream 4.5",
    description: "ByteDance's next-gen 4K image model",
    icon: "seedream",
    qualityOptions: ["2K", "4K"],
    defaultQuality: "4K",
    aspectRatioOptions: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    defaultAspectRatio: "3:2",
    showUpload: true,
    showDraw: false,
    defaultCount: 1,
    maxCount: 4,
    generateCredits: 1,
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    description: "Google's flagship generation model",
    icon: "google",
    qualityOptions: ["1K", "2K", "4K"],
    premiumQualityOptions: ["4K"],
    defaultQuality: "1K",
    aspectRatioOptions: ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"],
    defaultAspectRatio: "4:3",
    showUpload: true,
    showDraw: true,
    defaultCount: 1,
    maxCount: 4,
    generateCredits: 2,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    description: "Google image generation model",
    icon: "google",
    qualityOptions: ["1K", "2K", "4K"],
    premiumQualityOptions: ["4K"],
    defaultQuality: "1K",
    aspectRatioOptions: ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"],
    defaultAspectRatio: "4:3",
    showUpload: true,
    showDraw: false,
    defaultCount: 1,
    maxCount: 4,
    generateCredits: 2,
  },
  "nano-banana-2-lite": {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    description: "Fast Google image generation model",
    icon: "google",
    qualityOptions: [],
    defaultQuality: "",
    aspectRatioOptions: ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"],
    defaultAspectRatio: "21:9",
    showUpload: true,
    showDraw: false,
    defaultCount: 4,
    maxCount: 4,
    generateCredits: 1.5,
  },
  "higgsfield-soul-2": { ...DEFAULT_CONFIG, id: "higgsfield-soul-2", label: "Higgsfield Soul 2.0", description: "Next generation ultra-realistic fashion visuals", icon: "google" },
  "higgsfield-soul-cinema": { ...DEFAULT_CONFIG, id: "higgsfield-soul-cinema", label: "Higgsfield Soul Cinema", description: "Cinema-grade visual creation", icon: "google" },
  "recraft-v4-1": { ...DEFAULT_CONFIG, id: "recraft-v4-1", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", icon: "google" },
  "seedream-5-lite": { ...DEFAULT_CONFIG, id: "seedream-5-lite", label: "Seedream 5.0 lite", description: "Intelligent visual reasoning", icon: "seedream" },
  "nano-banana": { ...DEFAULT_CONFIG, id: "nano-banana", label: "Nano Banana", description: "Google's standard generation model", icon: "google" },
  "higgsfield-soul": { ...DEFAULT_CONFIG, id: "higgsfield-soul", label: "Higgsfield Soul", description: "Ultra-realistic fashion visuals", icon: "google" },
  "higgsfield-face-swap": { ...DEFAULT_CONFIG, id: "higgsfield-face-swap", label: "Higgsfield Face Swap", description: "Seamless face swapping", icon: "google" },
  "higgsfield-character-swap": { ...DEFAULT_CONFIG, id: "higgsfield-character-swap", label: "Higgsfield Character Swap", description: "Seamless character swapping", icon: "google" },
  "seedream-4-0": { ...DEFAULT_CONFIG, id: "seedream-4-0", label: "Seedream 4.0", description: "ByteDance's advanced image editing model", icon: "seedream" },
  "gpt-image-1-5": { ...DEFAULT_CONFIG, id: "gpt-image-1-5", label: "GPT Image 1.5", description: "True-color precision rendering", icon: "openai" },
  "grok-imagine": { ...DEFAULT_CONFIG, id: "grok-imagine", label: "Grok Imagine", description: "Versatile image styles by xAI", icon: "google" },
  "recraft-v4-1-alt": { ...DEFAULT_CONFIG, id: "recraft-v4-1-alt", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", icon: "google" },
  "recraft-v4-1-utility": { ...DEFAULT_CONFIG, id: "recraft-v4-1-utility", label: "Recraft V4.1 Utility", description: "Simple scenes with flat, even lighting", icon: "google" },
  "z-image": { ...DEFAULT_CONFIG, id: "z-image", label: "Z-Image", description: "Instant lifelike portraits", icon: "google" },
  "kling-o1": { ...DEFAULT_CONFIG, id: "kling-o1", label: "Kling O1", description: "Kling's Photorealistic Image Model", icon: "google" },
  "flux-2-pro": { ...DEFAULT_CONFIG, id: "flux-2-pro", label: "FLUX.2 Pro", description: "Speed-optimized detail", icon: "google" },
  "flux-2-flex": { ...DEFAULT_CONFIG, id: "flux-2-flex", label: "FLUX.2 Flex", description: "Next-gen image generation", icon: "google" },
  "flux-2-max": { ...DEFAULT_CONFIG, id: "flux-2-max", label: "FLUX.2 Max", description: "Ultimate precision and speed", icon: "google" },
  "flux-kontext-max": { ...DEFAULT_CONFIG, id: "flux-kontext-max", label: "Flux Kontext Max", description: "Edit with accuracy", icon: "google" },
  "gpt-image": { ...DEFAULT_CONFIG, id: "gpt-image", label: "GPT Image", description: "Versatile text-to-image AI", icon: "openai" },
  "multi-reference": { ...DEFAULT_CONFIG, id: "multi-reference", label: "Multi Reference", description: "Multiple edits in one shot", icon: "google" },
  "reve": { ...DEFAULT_CONFIG, id: "reve", label: "Reve", description: "Advanced image editing model", icon: "google" },
  "wan-2-2": { ...DEFAULT_CONFIG, id: "wan-2-2", label: "WAN 2.2", description: "High-fidelity cinematic visuals", icon: "google" },
};

export const FEATURED_IMAGE_MODELS = [
  IMAGE_MODEL_CONFIGS["gpt-image-2"],
  IMAGE_MODEL_CONFIGS["seedream-4-5"],
  IMAGE_MODEL_CONFIGS["nano-banana-pro"],
  IMAGE_MODEL_CONFIGS["nano-banana-2"],
  IMAGE_MODEL_CONFIGS["nano-banana-2-lite"],
];

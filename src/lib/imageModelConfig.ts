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
    badge: "New",
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
};

export const FEATURED_IMAGE_MODELS = [
  IMAGE_MODEL_CONFIGS["gpt-image-2"],
  IMAGE_MODEL_CONFIGS["seedream-4-5"],
  IMAGE_MODEL_CONFIGS["nano-banana-pro"],
  IMAGE_MODEL_CONFIGS["nano-banana-2"],
  IMAGE_MODEL_CONFIGS["nano-banana-2-lite"],
];

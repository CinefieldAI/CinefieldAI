export interface CreateImageModel {
  name: string;
  description: string;
  badge?: "TOP" | "NEW";
  /** Optional custom icon image (public path). Falls back to the name initial. */
  icon?: string;
}

export const FEATURED_MODELS: CreateImageModel[] = [
  { name: "Higgsfield Soul 2.0", description: "Photoreal portrait engine", badge: "TOP" },
  { name: "Higgsfield Soul Cinema", description: "Cinematic character stills" },
  { name: "GPT Image 2", description: "OpenAI · general purpose" },
  { name: "Seedream 4.5", description: "Balanced quality & speed" },
  {
    name: "Nano Banana Pro",
    description: "High-fidelity drafts",
    badge: "NEW",
    icon: "/de397d3b-0644-47ac-a4fe-49d64ede48d3.png",
  },
  { name: "Nano Banana 2", description: "Fast iteration drafts" },
  { name: "Recraft V4.1", description: "Vector & raster design" },
];

export const ALL_MODELS: CreateImageModel[] = [
  { name: "Nano Banana", description: "Quick stylized drafts" },
  { name: "Higgsfield Soul", description: "Original portrait engine" },
  { name: "Higgsfield Face Swap", description: "Transfer a face across any image" },
  { name: "Higgsfield Character Swap", description: "Replace a full subject seamlessly" },
  { name: "Seedream 4.0", description: "Lightweight diffusion" },
  { name: "GPT Image 1.5", description: "OpenAI · balanced quality" },
  { name: "Grok Imagine", description: "xAI · expressive generation" },
  { name: "Recraft V4.1", description: "Vector & raster design" },
  { name: "Recraft V4.1 Utility", description: "Icon & asset generation" },
  { name: "Z-Image", description: "Compact high-speed model" },
  { name: "Kling O1", description: "Advanced image editing" },
  { name: "FLUX.2 Pro", description: "Black Forest Labs · photoreal" },
  { name: "FLUX.2 Flex", description: "Flexible aspect & control" },
  { name: "FLUX.2 Max", description: "Maximum fidelity render" },
  { name: "Flux Kontext Max", description: "Context-aware editing" },
  { name: "GPT Image", description: "OpenAI · general purpose" },
  { name: "Multi Reference", description: "Blend multiple reference images" },
  { name: "Reve", description: "Editorial-grade rendering" },
  { name: "Seedream 5.0 Lite", description: "Lightweight diffusion" },
  { name: "WAN 2.2", description: "Fast stylized motion stills" },
];

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

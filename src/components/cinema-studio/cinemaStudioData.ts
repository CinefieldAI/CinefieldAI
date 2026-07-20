import {
  Aperture,
  BarChart3,
  Camera,
  Clapperboard,
  Compass,
  Copy,
  Film,
  Home,
  Heart,
  Layers,
  MapPin,
  Rabbit,
  Sparkle,
  Sparkles,
  Star,
  UserRound,
  Users,
  Wand2,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Neon turquoise brand accent — DO NOT CHANGE. */
export const ACCENT = "#00e5ff";

/** Seedance family icon (replaces the old Runway-branded PNG). */
export const SEEDANCE_ICON = "/775d3617-427c-4cca-ae5c-db5ae6b1c64f-removebg-preview.png";

/* ------------------------------------------------------------------ */
/* Settings shape                                                      */
/* ------------------------------------------------------------------ */

export interface CinemaStudioSettings {
  model: string;
  genre?: string;
  style?: {
    colorPalette?: string[];
    lighting?: string[];
    cameraMovement?: string[];
  };
  camera?: {
    camera?: string;
    lens?: string;
    focalLength?: number;
    aperture?: string;
  };
  aspectRatio: string;
  resolution: string;
  duration: number;
  batch: string;
  sound: boolean;
  creditCost: number;
}

export type ModelBadge = "NEW" | "EXCLUSIVE" | "PREMIUM";

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  resolution: "4K" | "2K" | "1080p" | "720p" | "512p";
  durations: number[];
  /** Human-readable duration range, e.g. "6s-10s" (for submenu display). */
  durationLabel?: string;
  /** Model-specific default duration applied on selection. */
  defaultDuration?: number;
  badges?: ModelBadge[];
  /** Shows a small sound/audio icon next to the name (e.g. Wan 2.5, Wan 2.5 Fast). */
  sound?: boolean;
  baseCredits: number;
  /** Supports Character & Style controls. */
  characterStyle?: boolean;
  /** All-models entries may expand into a submenu of variants. */
  submodels?: ModelInfo[];
  /** Per-model icon (LucideIcon or image path string). */
  icon?: LucideIcon | string;
}

export interface ModelCategory {
  label: string;
  models: ModelInfo[];
}

const RES_CRED: Record<string, number> = {
  "4K": 200,
  "2K": 150,
  "1080p": 120,
  "720p": 60,
  "512p": 40,
};

/** Video submodel (variant). durationLabel like "6s-10s" or "5s". */
const vsub = (
  id: string,
  name: string,
  resolution: ModelInfo["resolution"],
  durationLabel: string,
  badges?: ModelBadge[],
  sound?: boolean,
): ModelInfo => ({
  id,
  name,
  description: "",
  resolution,
  durationLabel,
  durations: durationLabel.replace(/s/g, "").split("-").map(Number),
  baseCredits: RES_CRED[resolution] ?? 80,
  badges,
  sound,
});

/** Video parent category (renders with a right-side flyout of submodels). */
const vparent = (
  id: string,
  name: string,
  description: string,
  icon: LucideIcon | string,
  submodels: ModelInfo[],
  badges?: ModelBadge[],
): ModelInfo => ({
  id,
  name,
  description,
  icon,
  badges,
  resolution: submodels[0].resolution,
  durations: submodels[0].durations,
  baseCredits: submodels[0].baseCredits,
  submodels,
});

/** Flat Featured/quick-access video model (shows resolution + duration). */
const vfeat = (
  id: string,
  name: string,
  icon: LucideIcon | string,
  resolution: ModelInfo["resolution"],
  durationLabel: string,
  badges?: ModelBadge[],
  sound?: boolean,
): ModelInfo => ({ ...vsub(id, name, resolution, durationLabel, badges, sound), icon });

export const MODEL_CATEGORIES: ModelCategory[] = [
  {
    label: "Cinematic models",
    models: [
      {
        id: "cinema-3.5",
        name: "Cinema Studio 3.5",
        description: "Camera selection and style presets",
        icon: Clapperboard,
        resolution: "4K",
        durations: [4, 8, 15, 24],
        defaultDuration: 8,
        baseCredits: 240,
        characterStyle: true,
      },
      {
        id: "cinema-3.0",
        name: "Cinema Studio 3.0",
        description: "Enhanced camera and speed ramp control",
        icon: Clapperboard,
        resolution: "1080p",
        durations: [4, 8, 15, 24],
        defaultDuration: 8,
        baseCredits: 180,
        characterStyle: true,
      },
      {
        id: "cinema-2.5",
        name: "Cinema Studio 2.5",
        description: "Camera movements with start frame",
        icon: Clapperboard,
        resolution: "1080p",
        durations: [4, 8, 15],
        defaultDuration: 8,
        baseCredits: 120,
        characterStyle: true,
      },
    ],
  },
  {
    label: "Featured models",
    models: [
      vfeat("seedance-2.0", "Seedance 2.0", SEEDANCE_ICON, "4K", "4s-15s"),
      vfeat("seedance-2.0-mini", "Seedance 2.0 Mini", SEEDANCE_ICON, "720p", "4s-15s"),
      vfeat("seedance-2.0-fast", "Seedance 2.0 Fast", SEEDANCE_ICON, "720p", "4s-15s"),
      vfeat("gemini-omni-flash", "Gemini Omni Flash", "/Google_Veo_3.1.png", "720p", "4s-10s"),
      vfeat("kling-3.0", "Kling 3.0", "/Kling_3.0.png", "4K", "3s-15s", undefined, true),
      vfeat("kling-3.0-turbo", "Kling 3.0 Turbo", "/Kling_3.0.png", "1080p", "3s-15s"),
      vfeat("kling-3.0-motion-control", "Kling 3.0 Motion Control", "/Kling_3.0.png", "1080p", "3s-30s"),
      vfeat("happyhorse", "HappyHorse", Rabbit, "1080p", "3s-15s", undefined, true),
      vfeat("grok-base", "Grok Imagine", "/Grok_Imagine_1.5.png", "720p", "1s-15s"),
      vfeat("veo-3.1-lite", "Google Veo 3.1 Lite", "/Google_Veo_3.1.png", "1080p", "4s-8s", undefined, true),
      vfeat("wan-2.7", "Wan 2.7", Wind, "1080p", "2s-15s"),
    ],
  },
  {
    label: "All models",
    models: [
      vparent(
        "minimax-hailuo",
        "Minimax Hailuo",
        "High-dynamic, VFX-ready, fastest and most affordable",
        "/Minimax_Hailuo_2.3.png",
        [
          vsub("minimax-2.3-fast", "Minimax Hailuo 2.3 Fast", "1080p", "6s-10s"),
          vsub("minimax-2.3", "Minimax Hailuo 2.3", "1080p", "6s-10s"),
          vsub("minimax-02-fast", "Minimax Hailuo 02 Fast", "512p", "6s-10s"),
          vsub("minimax-02", "Minimax Hailuo 02", "1080p", "6s-10s"),
        ],
      ),
      vparent(
        "kling",
        "Kling",
        "Perfect motion with advanced video control",
        "/Kling_3.0.png",
        [
          vsub("kling-3.0", "Kling 3.0", "4K", "3s-15s", undefined, true),
          vsub("kling-3.0-turbo", "Kling 3.0 Turbo", "1080p", "3s-15s", undefined, true),
          vsub("kling-3.0-omni", "Kling 3.0 Omni", "4K", "3s-15s"),
          vsub("kling-3.0-mini", "Kling 3.0 Omni", "4K", "3s-15s"),
          {
            ...vsub("kling-3.0-omni-edit", "Kling 3.0 Omni Edit", "1080p", "3s-10s"),
            defaultDuration: 4,
          },
          vsub("kling-2.6", "Kling 2.6", "1080p", "5s-10s", undefined, true),
          vsub("kling-2.6-max", "Kling O1 Video", "1080p", "5s-10s"),
          vsub("kling-01-video", "Kling O1 Video", "1080p", "5s-10s"),
          {
            ...vsub("kling-o1-video-edit", "Kling O1 Video Edit", "1080p", "3s-10s"),
            defaultDuration: 7,
          },
          vsub("kling-motion-control", "Kling Motion Control", "1080p", "3s-30s"),
          vsub("kling-3.0-motion-control", "Kling 3.0 Motion Control", "1080p", "3s-30s"),
          vsub("kling-2.5-turbo", "Kling 2.5 Turbo", "1080p", "5s-10s"),
          vsub("kling-2.1", "Kling 2.1", "1080p", "5s-10s"),
          vsub("kling-2.1-master", "Kling 2.1 Master", "1080p", "5s-10s"),
        ],
      ),
      vparent(
        "openai-sora",
        "OpenAI Sora 2",
        "Multi-shot video with sound generation",
        "/Sora_2.png",
        [
          vsub("sora-2", "Sora 2", "720p", "4s-12s"),
          vsub("sora-3.1-lite", "Sora 3.1 Lite", "720p", "6s-10s"),
          vsub("sora-2-pro", "Sora 2 Pro", "1080p", "4s-12s"),
          vsub("sora-2-3.1-fast", "Sora 2 3.1 Fast", "1080p", "6s-10s"),
          vsub("sora-2-max", "Sora 2 Max", "1080p", "4s-12s"),
          vsub("sora-2-pro-max", "Sora 2 Pro Max", "1080p", "4s-12s"),
        ],
      ),
      vparent(
        "google-veo",
        "Google Veo",
        "Precision video with sound control",
        "/Google_Veo_3.1.png",
        [
          vsub("veo-3.1", "Google Veo 3.1", "1080p", "4s-8s"),
          vsub("veo-3.1-fast", "Google Veo 3.1 Fast", "1080p", "4s-8s"),
          vsub("veo-3-fast", "Google Veo 3 Fast", "1080p", "4s-8s"),
          vsub("veo-3", "Google Veo 3", "1080p", "4s-8s"),
        ],
      ),
      vparent(
        "higgsfield",
        "Higgsfield",
        "Advanced camera controls and effect presets",
        Sparkles,
        [
          vsub("higgsfield-lite", "Higgsfield Lite", "720p", "3s-5s"),
          vsub("higgsfield-standard", "Higgsfield Standard", "720p", "3s-5s"),
          vsub("higgsfield-turbo", "Higgsfield Turbo", "720p", "3s-5s"),
        ],
      ),
      vparent(
        "wan",
        "Wan",
        "Camera-controlled video with sound, more freedom",
        Wind,
        [
          vsub("wan-2.7", "Wan 2.7", "1080p", "2s-15s"),
          vsub("wan-2.6", "Wan 2.6", "1080p", "5s-15s"),
          vsub("wan-2.5", "Wan 2.5", "1080p", "5s-10s", undefined, true),
          vsub("wan-2.5-fast", "Wan 2.5 Fast", "1080p", "5s-10s", undefined, true),
          vsub("wan-2.2", "Wan 2.2", "720p", "5s"),
          vsub("wan-2.2-fast", "Wan 2.2 Fast", "720p", "5s"),
        ],
      ),
      vparent(
        "seedance",
        "Seedance",
        "Cinematic, multi-shot video creation",
        SEEDANCE_ICON,
        [
          { ...vsub("seedance-2.0-fast", "Seedance 2.0 Fast", "720p", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-2.0-mini", "Seedance 2.0 Mini", "720p", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-2.0", "Seedance 2.0", "4K", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-1.5-pro", "Seedance 1.5 Pro", "720p", "4s-12s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-pro", "Seedance Pro", "1080p", "5s-10s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-pro-fast", "Seedance Pro Fast", "1080p", "5s-10s"), icon: SEEDANCE_ICON },
        ],
      ),
      vparent(
        "happyhorse-cat",
        "HappyHorse",
        "",
        Rabbit,
        [vsub("happyhorse", "HappyHorse", "1080p", "3s-15s")],
      ),
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Image-mode models (shown when the left toggle is set to Image)      */
/* ------------------------------------------------------------------ */

const M = (
  id: string,
  name: string,
  description: string,
  icon: LucideIcon | string,
  opts: { resolution?: ModelInfo["resolution"]; isNew?: boolean } = {},
): ModelInfo => ({
  id,
  name,
  description,
  icon,
  resolution: opts.resolution ?? "2K",
  durations: [1],
  baseCredits: 1,
  badges: undefined,
});

/** Each image model defined once; reused across Featured/All so selection syncs. */
const IM = {
  aiCast: M("ai-cast", "AI Cast", "Expressive faces and detailed styling", UserRound),
  locations: M("cinematic-locations", "Cinematic Locations", "Rich environments with cinematic lighting", MapPin),
  soulCinemaC: M("soul-cinema-c", "Soul Cinema", "Cinematic image generation", Clapperboard),
  cameras: M("cinematic-cameras", "Cinematic Cameras", "Image generation with camera controls", Camera),
  soul2: M("higgsfield-soul-2", "Higgsfield Soul 2.0", "Next generation ultra-realistic fashion visuals", Sparkles),
  soulCinema: M("higgsfield-soul-cinema", "Higgsfield Soul Cinema", "Cinema-grade visual creation", Sparkles),
  gpt2: M("gpt-image-2", "GPT Image 2", "4K images with near-perfect text rendering", "/GPT_Image_-_OpenAI.png", { resolution: "4K", isNew: true }),
  seedream45: M("seedream-4-5", "Seedream 4.5", "ByteDance's next-gen 4K image-editing model", BarChart3, { resolution: "4K" }),
  nanoPro: M("nano-banana-pro", "Nano Banana Pro", "Google's flagship generation model", "/Nano_Banana.png"),
  nano2: M("nano-banana-2", "Nano Banana 2", "Pro quality at Flash speed", "/Nano_Banana.png", { isNew: true }),
  recraft: M("recraft-v4-1", "Recraft V4.1", "Photorealistic and expressive image generation", "/Recraft_V4.1.png", { isNew: true }),
  auto: M("auto", "Auto", "The best model for any prompt, chosen for you", Wand2),
  soul: M("higgsfield-soul", "Higgsfield Soul", "Ultra-realistic fashion visuals", Sparkles),
  gpt15: M("gpt-image-1-5", "GPT Image 1.5", "True-color precision rendering", "/GPT_Image_-_OpenAI.png"),
  gpt: M("gpt-image", "GPT Image", "Versatile text-to-image AI", "/GPT_Image_-_OpenAI.png"),
  nano: M("nano-banana", "Nano Banana", "Google's standard generation model", "/Nano_Banana.png"),
  seedream5lite: M("seedream-5-lite", "Seedream 5.0 lite", "Intelligent visual reasoning", BarChart3),
  seedream4: M("seedream-4-0", "Seedream 4.0", "ByteDance's advanced image editing model", BarChart3),
  grok: M("grok-imagine-image", "Grok Imagine", "Versatile image styles by xAI", Zap),
  recraftUtil: M("recraft-utility", "Recraft V4.1 Utility", "Simple scenes with flat, even lighting", "/Recraft_V4.1.png", { isNew: true }),
  zImage: M("z-image", "Z-Image", "Instant lifelike portraits", Star),
  kling01: M("kling-01", "Kling O1", "Kling's Photorealistic Image Model", Aperture),
  flux2pro: M("flux-2-pro", "FLUX.2 Pro", "Speed-optimized detail", "/FLUX.2.png"),
  flux2flex: M("flux-2-flex", "FLUX.2 Flex", "Edit with accuracy", "/FLUX.2.png"),
  flux2max: M("flux-2-max", "FLUX.2 MAX", "Sharp text, maximum detail", "/FLUX.2.png", { resolution: "4K" }),
  reve: M("reve", "Reve", "Advanced editing model", "/Reve.png"),
  fluxKontext: M("flux-kontext-max", "Flux Kontext Max", "Edit with accuracy", "/FLUX.2.png"),
  multiRef: M("multi-reference", "Multi Reference", "Multiple edits in one shot", Copy),
  wan22: M("wan-2-2", "WAN 2.2", "High-fidelity cinematic visuals", Sparkle),
} as const;

export const IMAGE_MODEL_CATEGORIES: ModelCategory[] = [
  {
    label: "Cinematic models",
    models: [IM.aiCast, IM.locations, IM.soulCinemaC, IM.cameras],
  },
  {
    label: "Featured models",
    models: [
      IM.soul2,
      IM.soulCinema,
      IM.gpt2,
      IM.seedream45,
      IM.nanoPro,
      IM.nano2,
      IM.recraft,
    ],
  },
  {
    label: "All models",
    models: [
      IM.auto,
      IM.soul,
      IM.soul2,
      IM.soulCinema,
      IM.gpt2,
      IM.gpt15,
      IM.gpt,
      IM.nanoPro,
      IM.nano2,
      IM.nano,
      IM.seedream5lite,
      IM.seedream45,
      IM.seedream4,
      IM.grok,
      IM.recraft,
      IM.recraftUtil,
      IM.zImage,
      IM.kling01,
      IM.flux2pro,
      IM.flux2flex,
      IM.flux2max,
      IM.reve,
      IM.fluxKontext,
      IM.multiRef,
      IM.wan22,
    ],
  },
];

/** Flat lookup of every model (video + image), including submodel variants. */
export const ALL_MODELS: ModelInfo[] = MODEL_CATEGORIES.flatMap((c) =>
  c.models.flatMap((m) => [m, ...(m.submodels ?? [])]),
);

/** De-duplicated flat list of image models for lookups. */
export const IMAGE_MODELS: ModelInfo[] = Object.values(IM);

export function getModel(id: string): ModelInfo {
  return (
    [...ALL_MODELS, ...IMAGE_MODELS].find((m) => m.id === id) ?? ALL_MODELS[0]
  );
}

/* ------------------------------------------------------------------ */
/* Genre / Style / Camera option sets                                  */
/* ------------------------------------------------------------------ */

export interface GenreOption {
  name: string;
  gradient: string;
  /** Looping preview clip shown inside the genre circle, if available. */
  video?: string;
}

export const GENRES: GenreOption[] = [
  { name: "General", gradient: "linear-gradient(135deg,#3a3a3a,#0a0a0a)" },
  { name: "Action", gradient: "linear-gradient(135deg,#ff5f6d,#7a1c1c)", video: "/Action.mp4" },
  { name: "Horror", gradient: "linear-gradient(135deg,#1a1a1a,#4a0000)", video: "/Horror.mp4" },
  { name: "Comedy", gradient: "linear-gradient(135deg,#ffd166,#b06a00)", video: "/Comedy.mp4" },
  { name: "Noir", gradient: "linear-gradient(135deg,#2b2b2b,#000000)" },
  { name: "Drama", gradient: "linear-gradient(135deg,#4361ee,#1a1a4a)", video: "/Drama.mp4" },
  { name: "Epic", gradient: "linear-gradient(135deg,#f4a261,#5a2a00)", video: "/epic.mp4" },
];

export const COLOR_PALETTES = [
  "Auto",
  "Naturalistic Clean",
  "Bleached Warm",
  "Hyper Neon",
  "Teal Orange Epic",
  "Sodium Decay",
  "Cold Steel",
  "Bleach Bypass",
  "Classic Bw",
];
export const LIGHTING = [
  "Auto",
  "Soft Cross",
  "Contre Jour",
  "Overhead Fall",
  "Window",
  "Practicals",
  "Silhouette",
];
export const CAMERA_MOVEMENTS = [
  "Auto",
  "Classic Static",
  "Silent Machine",
  "One Take",
  "Epic Scale",
  "Intimate Observer",
  "Impossible Camera",
  "Documentary Snap",
  "Raw Chaos",
  "Dreamy Flow",
];

export const CAMERAS = ["Auto", "Classic Digital", "Vintage Haze"];
export const LENSES = ["Auto", "35mm", "50mm", "85mm"];
export const APERTURES = ["Auto", "f/1.4", "f/2.8", "f/4", "f/8"];

/* ------------------------------------------------------------------ */
/* Prompt-bar option sets                                              */
/* ------------------------------------------------------------------ */

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9"];

export interface AspectRatioOption {
  value: string;
  description: string;
  /** Preview-icon width:height ratio (relative units). */
  shape: [number, number];
}

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  { value: "Auto", description: "Model default", shape: [1, 1] },
  { value: "1:1", description: "Square", shape: [1, 1] },
  { value: "3:4", description: "Portrait", shape: [3, 4] },
  { value: "9:16", description: "Stories/Reels", shape: [9, 16] },
  { value: "4:3", description: "Standard", shape: [4, 3] },
  { value: "16:9", description: "Widescreen", shape: [16, 9] },
  { value: "21:9", description: "Cinematic", shape: [21, 9] },
];
export const RESOLUTIONS = ["720p", "1080p", "2K", "4K"];
export const BATCHES = ["1/4", "2/4", "3/4", "4/4"];

/* ------------------------------------------------------------------ */
/* Sidebar navigation + projects                                       */
/* ------------------------------------------------------------------ */

export interface NavItem {
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: Home },
  { label: "My generations", icon: Film },
  { label: "My elements", icon: Layers },
  { label: "My favorites", icon: Heart },
  { label: "Community feed", icon: Compass },
];

export interface Project {
  id: string;
  name: string;
  editedAt: string;
  privacy: "Private" | "Public";
  gradient: string;
}

export const MOCK_PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Neon Tokyo Chase",
    editedAt: "2h ago",
    privacy: "Private",
    gradient: "linear-gradient(135deg,#00e5ff33,#0a0a0a)",
  },
  {
    id: "p2",
    name: "Desert Mirage",
    editedAt: "Yesterday",
    privacy: "Public",
    gradient: "linear-gradient(135deg,#f4a26133,#0a0a0a)",
  },
  {
    id: "p3",
    name: "Midnight Noir",
    editedAt: "3 days ago",
    privacy: "Private",
    gradient: "linear-gradient(135deg,#4361ee33,#0a0a0a)",
  },
  {
    id: "p4",
    name: "Cosmic Drift",
    editedAt: "Last week",
    privacy: "Public",
    gradient: "linear-gradient(135deg,#9b5de533,#0a0a0a)",
  },
];

/** Hero example thumbnails (decorative gradients). */
export const HERO_THUMBS = [
  "linear-gradient(135deg,#00e5ff44,#0a0a0a)",
  "linear-gradient(135deg,#ff5f6d44,#0a0a0a)",
  "linear-gradient(135deg,#ffd16644,#0a0a0a)",
  "linear-gradient(135deg,#4361ee44,#0a0a0a)",
];

/** Decorative meta icons (kept exported for reuse). */
export const META_ICONS = { Star, Sparkles, Users, Clapperboard };

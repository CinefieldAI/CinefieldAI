import {
  Camera,
  Clapperboard,
  Compass,
  Film,
  Home,
  Heart,
  Layers,
  MapPin,
  Sparkle,
  Sparkles,
  Star,
  UserRound,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import WanIcon from "./icons/WanIcon";
import {
  GoogleIcon,
  GrokIcon,
  OpenAIIcon,
  OpenAISoraIcon,
  SeedanceIcon,
  SeedreamIcon,
  KlingIcon,
  RecraftIcon,
  FluxIcon,
  MinimaxIcon,
  HappyHorseIcon,
  MultiReferenceIcon,
} from "./icons/ProviderIcons";

import { getSharedModelIcon } from "@/lib/modelIconRegistry";

/** Neon turquoise brand accent — DO NOT CHANGE. */
export const ACCENT = "#D97757";

/** Exact supplied brand SVGs, one per provider — used in place of the old
 *  PNG screenshots so every model row and its trigger render the real
 *  vector icon supplied for that provider. */
export const SEEDANCE_ICON = SeedanceIcon;
export const GOOGLE_ICON = GoogleIcon;
export const KLING_ICON = KlingIcon;
export const SORA_ICON = OpenAISoraIcon;
export const GROK_ICON = GrokIcon;

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

export type ModelBadge = "NEW" | "EXCLUSIVE" | "PREMIUM" | "TOP";

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
  /** Per-model icon (LucideIcon or image path string or React Component). */
  icon?: LucideIcon | string | React.ComponentType<{ className?: string }>;
  isAdded?: boolean;
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
        durations: [4, 15],
        defaultDuration: 10,
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
      {
        id: "cinema-studio-4.0",
        name: "Cinema Studio 4.0",
        description: "Direct every detail — film setup, camera, color and lighting",
        icon: Clapperboard,
        resolution: "1080p",
        durations: [5],
        defaultDuration: 5,
        baseCredits: 80,
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
      vfeat("gemini-omni-flash", "Gemini Omni Flash", GOOGLE_ICON, "720p", "4s-10s"),
      vfeat("kling-3.0", "Kling 3.0", KLING_ICON, "4K", "3s-15s", undefined, true),
      vfeat("kling-3.0-turbo", "Kling 3.0 Turbo", KLING_ICON, "1080p", "3s-15s"),
      vfeat("kling-3.0-motion-control", "Kling 3.0 Motion Control", KLING_ICON, "1080p", "3s-30s"),
      vfeat("happyhorse", "HappyHorse", HappyHorseIcon, "1080p", "3s-15s", undefined, true),
      vfeat("grok-base", "Grok Imagine", GROK_ICON, "720p", "1s-15s"),
      vfeat("veo-3.1-lite", "Google Veo 3.1 Lite", GOOGLE_ICON, "1080p", "4s-8s", undefined, true),
      vfeat("wan-2.7", "Wan 2.7", WanIcon, "1080p", "2s-15s"),
    ],
  },
  {
    label: "All models",
    models: [
      vparent(
        "minimax-hailuo",
        "Minimax Hailuo",
        "High-dynamic, VFX-ready, fastest and most affordable",
        MinimaxIcon,
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
        KLING_ICON,
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
        SORA_ICON,
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
        GOOGLE_ICON,
        [
          vsub("veo-3.1", "Google Veo 3.1", "1080p", "4s-8s"),
          vsub("veo-3.1-fast", "Google Veo 3.1 Fast", "1080p", "4s-8s"),
          vsub("veo-3-fast", "Google Veo 3 Fast", "1080p", "4s-8s"),
          vsub("veo-3", "Google Veo 3", "1080p", "4s-8s"),
        ],
      ),
      vparent(
        "higgsfield",
        "🚫 Cinefield",
        "Advanced camera controls and effect presets",
        Sparkles,
        [
          vsub("higgsfield-lite", "🚫 Cinefield Lite", "720p", "3s-5s"),
          vsub("higgsfield-standard", "🚫 Cinefield Standard", "720p", "3s-5s"),
          vsub("higgsfield-turbo", "🚫 Cinefield Turbo", "720p", "3s-5s"),
        ],
      ),
      vparent(
        "wan",
        "Wan",
        "Camera-controlled video with sound, more freedom",
        WanIcon,
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
        HappyHorseIcon,
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
  fallbackIcon: LucideIcon | string | React.ComponentType<{ className?: string }>,
  opts: { resolution?: ModelInfo["resolution"]; badge?: ModelBadge; isAdded?: boolean } = {},
): ModelInfo => {
  const sharedIcon = getSharedModelIcon(name);
  return {
    id,
    name,
    description,
    icon: sharedIcon ?? fallbackIcon,
    resolution: opts.resolution ?? "2K",
    durations: [1],
    baseCredits: 1,
    badges: opts.badge ? [opts.badge] : undefined,
    isAdded: opts.isAdded,
  };
};

/** Each image model defined once; reused across Featured/All so selection syncs. */
const IM = {
  aiCast: M("ai-cast", "AI Cast", "Expressive faces and detailed styling", UserRound),
  locations: M("cinematic-locations", "Cinematic Locations", "Rich environments with cinematic lighting", MapPin),
  soulCinemaC: M("soul-cinema-c", "Soul Cinema", "Cinematic image generation", Clapperboard),
  cameras: M("cinematic-cameras", "Cinematic Cameras", "Image generation with camera controls", Camera),
  soul2: M("higgsfield-soul-2", "🚫 Cinefield Soul 2.0", "Photoreal portrait engine", Sparkles, { badge: "TOP" }),
  soulCinema: M("higgsfield-soul-cinema", "🚫 Cinefield Soul Cinema", "Cinematic character stills", Sparkles),
  gpt2: M("gpt-image-2", "GPT Image 2", "4K images with near-perfect text rendering", OpenAIIcon, { resolution: "4K", badge: "NEW" }),
  seedream45: M("seedream-4-5", "Seedream 4.5", "Balanced quality & speed", SeedreamIcon, { resolution: "4K", badge: "PREMIUM", isAdded: true }),
  seedream5pro: M("seedream-5-pro", "Seedream 5.0 Pro", "Logically consistent images with intelligent visual reasoning", SeedreamIcon, { badge: "NEW", isAdded: true }),
  nanoPro: M("nano-banana-pro", "Nano Banana Pro", "Google's flagship generation model", GoogleIcon),
  nano2: M("nano-banana-2", "Nano Banana 2", "Fast iteration drafts", GoogleIcon, { badge: "PREMIUM" }),
  nano2lite: M("nano-banana-2-lite", "Nano Banana 2 Lite", "Lightweight generation at speed", GoogleIcon, { badge: "NEW", isAdded: true }),
  recraft: M("recraft-v4-1", "Recraft V4.1", "Photorealistic and expressive image generation", RecraftIcon, { badge: "NEW" }),
  auto: M("auto", "Auto", "Automatically pick the best model for your prompt", Wand2),
  soul: M("higgsfield-soul", "🚫 Cinefield Soul", "Original portrait engine", Sparkles, { isAdded: true }),
  faceSwap: M("higgsfield-face-swap", "🚫 Cinefield Face Swap", "Transfer a face across any image", UserRound, { isAdded: true }),
  characterSwap: M("higgsfield-character-swap", "🚫 Cinefield Character Swap", "Replace a full subject seamlessly", Users, { isAdded: true }),
  gpt15: M("gpt-image-1-5", "GPT Image 1.5", "OpenAI · balanced quality", OpenAIIcon),
  gpt: M("gpt-image", "GPT Image", "OpenAI · general purpose", OpenAIIcon, { isAdded: true }),
  nano: M("nano-banana", "Nano Banana", "Quick stylized drafts", GoogleIcon, { isAdded: true }),
  seedream5lite: M("seedream-5-lite", "Seedream 5.0 lite", "Intelligent visual reasoning", SeedreamIcon),
  seedream4: M("seedream-4-0", "Seedream 4.0", "Lightweight diffusion", SeedreamIcon, { isAdded: true }),
  grok: M("grok-imagine-image", "Grok Imagine", "Versatile image styles by xAI", GrokIcon, { badge: "PREMIUM" }),
  recraftUtil: M("recraft-utility", "Recraft V4.1 Utility", "Icon & asset generation", RecraftIcon, { isAdded: true }),
  zImage: M("z-image", "Z-Image", "Instant lifelike portraits", WanIcon),
  kling01: M("kling-01", "Kling O1", "Kling's Photorealistic Image Model", KlingIcon, { badge: "PREMIUM", isAdded: true }),
  flux2pro: M("flux-2-pro", "FLUX.2 Pro", "Speed-optimized detail", FluxIcon, { isAdded: true }),
  flux2flex: M("flux-2-flex", "FLUX.2 Flex", "Flexible aspect & control", FluxIcon, { isAdded: true }),
  flux2max: M("flux-2-max", "FLUX.2 Max", "Maximum fidelity render", FluxIcon, { resolution: "4K", isAdded: true }),
  reve: M("reve", "Reve", "Advanced editing model", Wand2),
  fluxKontext: M("flux-kontext-max", "Flux Kontext Max", "Context-aware editing", FluxIcon, { isAdded: true }),
  multiRef: M("multi-reference", "Multi Reference", "Blend multiple reference images", MultiReferenceIcon, { isAdded: true }),
  wan22: M("wan-2-2", "WAN 2.2", "High-fidelity cinematic visuals", Sparkle, { isAdded: true }),
} as const;

export const IMAGE_MODEL_CATEGORIES: ModelCategory[] = [
  {
    label: "Featured models",
    models: [
      IM.auto,
      IM.soul2,
      IM.soulCinema,
      IM.gpt2,
      IM.seedream5pro,
      IM.seedream45,
      IM.nanoPro,
      IM.nano2,
      IM.nano2lite,
      IM.recraft,
      IM.wan22,
    ],
  },
  {
    label: "All models",
    models: [
      IM.nano,
      IM.soul,
      IM.faceSwap,
      IM.characterSwap,
      IM.seedream4,
      IM.gpt15,
      IM.grok,
      IM.recraft,
      IM.recraftUtil,
      IM.zImage,
      IM.kling01,
      IM.flux2pro,
      IM.flux2flex,
      IM.flux2max,
      IM.fluxKontext,
      IM.gpt,
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
/* Cinema Studio 4.0 — Creative Controls option sets                   */
/* ------------------------------------------------------------------ */

/** Film setup → Era tab. */
export const CINEMA40_ERAS = ["Auto", "1960s", "1980s", "1990s", "2000s", "2020s"];

/** Film setup → Tempo tab (pacing of the montage). */
export const CINEMA40_TEMPO = ["Auto", "Slow Burn", "Steady", "Building", "Frenetic", "Whiplash"];

/** Camera → Setup tab, CAMERA group. */
export const CINEMA40_CAMERAS = ["Auto", "Modern", "35mm Film", "8mm Film", "DV Camcorder"];

/** Camera → Setup tab, LENS group. */
export const CINEMA40_LENSES = [
  "Auto",
  "Clean Sharp",
  "Anamorphic",
  "Vintage Anamorphic",
  "Warm Vintage",
  "Halation Vintage",
];

/**
 * Camera → Movement tab. Each entry inserts a `#Tag` into the prompt rather
 * than being "selected" — there is no active/inactive state, clicking one
 * just appends it (matching the reference: "Adds to the prompt box, or type
 * # there").
 */
export const CINEMA40_MOVEMENT_TAGS = [
  "Static shot",
  "Handheld",
  "Tracking",
  "POV",
  "Pan left",
  "Pan right",
  "Tilt up",
  "Tilt down",
  "Crane up",
  "Crane down",
  "Pedestal up",
  "Pedestal down",
  "Dolly in",
  "Dolly out",
  "Dolly zoom",
  "Truck left",
  "Truck right",
  "Slider left",
  "Slider right",
  "Arc left",
  "Arc right",
  "Side tracking",
  "Whip pan",
  "Slow zoom in",
  "Slow zoom out",
  "Crush zoom",
  "Rack focus",
  "Drone orbit",
  "Aerial pullback",
  "Helicopter shot",
  "Snorricam",
  "Robot arm",
  "Bullet time",
];

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

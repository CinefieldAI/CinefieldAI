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
  resolution: "4K" | "2K" | "1080p" | "768p" | "720p" | "512p";
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
  /** Replaces the resolution chip's text, for ranges like "480p-720p". */
  resolutionLabel?: string;
  /** Drops the resolution chip — Marketing Studio Video shows none. */
  hideResolution?: boolean;
  /** Drops the duration chip. */
  hideDuration?: boolean;
  /** Plain chips after the duration, e.g. "Edit Video", "Audio". */
  extraChips?: string[];
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
  // The Minimax Hailuo models are the only ones offering 768p.
  "768p": 70,
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
      // Order follows the reference's own Featured row: the 2.5 pair leads,
      // then the 2.0 trio, then H3.
      vfeat("seedance-2.5", "Seedance 2.5", SEEDANCE_ICON, "1080p", "4s-30s", ["NEW"], true),
      {
        ...vfeat("seedance-2.5-edit", "Seedance 2.5 Edit", SEEDANCE_ICON, "720p", "5s", ["NEW"], true),
        resolutionLabel: "480p-720p",
        hideDuration: true,
        extraChips: ["Edit Video", "Audio"],
      },
      vfeat("seedance-2.0", "Seedance 2.0", SEEDANCE_ICON, "4K", "4s-15s"),
      vfeat("seedance-2.0-fast", "Seedance 2.0 Fast", SEEDANCE_ICON, "720p", "4s-15s"),
      vfeat("seedance-2.0-mini", "Seedance 2.0 Mini", SEEDANCE_ICON, "720p", "4s-15s"),
      vfeat("minimax-h3", "MiniMax H3", MinimaxIcon, "2K", "5s-15s", ["NEW"]),
      vfeat("gemini-omni-flash", "Gemini Omni Flash", GOOGLE_ICON, "720p", "4s-10s"),
      vfeat("kling-3.0", "Kling 3.0", KLING_ICON, "4K", "3s-15s", undefined, true),
      vfeat("kling-3.0-turbo", "Kling 3.0 Turbo", KLING_ICON, "1080p", "3s-15s"),
      vfeat("kling-3.0-motion-control", "Kling 3.0 Motion Control", KLING_ICON, "1080p", "3s-30s"),
      vfeat("flux-3-video", "FLUX.3 Video", FluxIcon, "1080p", "5s-20s", ["NEW"], true),
      vfeat("grok-imagine-1.5", "Grok Imagine 1.5", GROK_ICON, "720p", "1s-15s"),
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
          vsub("minimax-h3", "MiniMax H3", "2K", "5s-15s", ["NEW"]),
          // The chip carries each model's top resolution. The 2.3 pair still
          // opens at 768p — PromptBar applies that on selection.
          vsub("minimax-2.3-fast", "Minimax Hailuo 2.3 Fast", "1080p", "6s-10s", undefined, true),
          vsub("minimax-2.3", "Minimax Hailuo 2.3", "1080p", "6s-10s", undefined, true),
          vsub("minimax-02-fast", "Minimax Hailuo 02 Fast", "512p", "6s-10s"),
          vsub("minimax-02", "Minimax Hailuo 02", "1080p", "6s-10s"),
        ],
      ),
      vfeat("flux-3-video", "FLUX.3 Video", FluxIcon, "1080p", "5s-20s", ["NEW"], true),
      vparent(
        "kling",
        "Kling",
        "Perfect motion with advanced video control",
        KLING_ICON,
        [
          vsub("kling-3.0", "Kling 3.0", "4K", "3s-15s", undefined, true),
          vsub("kling-3.0-turbo", "Kling 3.0 Turbo", "1080p", "3s-15s", undefined, true),
          // The reference lists "Kling 3.0 Omni" twice under the same name, but
          // the two rows are not the same model: the first opens in Frames
          // mode with a 5s/10s duration list and start/end frames, the second
          // in Elements mode with a 3s-15s slider and Multi-shot. PromptBar
          // already told them apart by id, so both rows are carried.
          vsub("kling-3.0-omni", "Kling 3.0 Omni", "4K", "3s-15s"),
          vsub("kling-3.0-mini", "Kling 3.0 Omni", "4K", "3s-15s"),
          {
            ...vsub("kling-3.0-omni-edit", "Kling 3.0 Omni Edit", "1080p", "3s-10s"),
            defaultDuration: 4,
          },
          vsub("kling-2.6", "Kling 2.6", "1080p", "5s-10s", undefined, true),
          // "Kling O1 Video" is also listed twice, but those two rows are
          // identical in name, chips and controls, so only one is carried.
          vsub("kling-01-video", "Kling O1 Video", "1080p", "5s-10s"),
          {
            ...vsub("kling-o1-video-edit", "Kling O1 Video Edit", "1080p", "3s-10s"),
            defaultDuration: 7,
            extraChips: ["Edit Video"],
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
          vsub("sora-2", "Sora 2", "720p", "4s-12s", undefined, true),
          vsub("sora-2-pro", "Sora 2 Pro", "1080p", "4s-12s", undefined, true),
          vsub("sora-2-max", "Sora 2 Max", "1080p", "4s-12s", undefined, true),
          vsub("sora-2-pro-max", "Sora 2 Pro Max", "1080p", "4s-12s", undefined, true),
        ],
      ),
      vparent(
        "google-veo",
        "Google Veo",
        "Precision video with sound control",
        GOOGLE_ICON,
        [
          vsub("veo-3.1-lite", "Google Veo 3.1 Lite", "1080p", "4s-8s", undefined, true),
          vsub("veo-3.1-fast", "Google Veo 3.1 Fast", "1080p", "4s-8s", undefined, true),
          vsub("veo-3.1", "Google Veo 3.1", "1080p", "4s-8s", undefined, true),
          // The Veo 3 pair is fixed at 8s, unlike the 3.1 models.
          vsub("veo-3-fast", "Google Veo 3 Fast", "1080p", "8s", undefined, true),
          vsub("veo-3", "Google Veo 3", "1080p", "8s", undefined, true),
        ],
      ),
      vfeat("gemini-omni-flash", "Gemini Omni Flash", GOOGLE_ICON, "720p", "4s-10s"),
      vparent(
        "higgsfield",
        "Cinefield",
        "Advanced camera controls and effect presets",
        Sparkles,
        [
          {
            ...vsub("marketing-studio-video", "Marketing Studio Video", "1080p", "5s-30s", ["NEW"]),
            hideResolution: true,
          },
          vsub("cinema-studio-4.0", "Cinema Studio 4.0 Video", "1080p", "4s-30s", ["NEW"]),
          vsub("cinema-studio-3.5", "Cinematic Studio Video 3.5", "1080p", "4s-15s"),
          vsub("higgsfield-lite", "Cinefield Lite", "720p", "3s-5s"),
          vsub("higgsfield-standard", "Cinefield Standard", "720p", "3s-5s"),
          vsub("higgsfield-turbo", "Cinefield Turbo", "720p", "3s-5s"),
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
          { ...vsub("seedance-2.5", "Seedance 2.5", "1080p", "4s-30s", ["NEW"], true), icon: SEEDANCE_ICON },
          {
            ...vsub("seedance-2.5-edit", "Seedance 2.5 Edit", "720p", "5s", ["NEW"], true),
            icon: SEEDANCE_ICON,
            // This row carries a resolution range and two mode chips in place
            // of a duration.
            resolutionLabel: "480p-720p",
            hideDuration: true,
            extraChips: ["Edit Video", "Audio"],
          },
          { ...vsub("seedance-2.0-fast", "Seedance 2.0 Fast", "720p", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-2.0-mini", "Seedance 2.0 Mini", "720p", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-2.0", "Seedance 2.0", "4K", "4s-15s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-1.5-pro", "Seedance 1.5 Pro", "720p", "4s-12s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-pro", "Seedance Pro", "1080p", "5s-10s"), icon: SEEDANCE_ICON },
          { ...vsub("seedance-pro-fast", "Seedance Pro Fast", "1080p", "5s-10s"), icon: SEEDANCE_ICON },
        ],
      ),
      vparent(
        "grok-imagine",
        "Grok Imagine",
        "Perfect motion with advanced video control",
        GROK_ICON,
        [
          vsub("grok-base", "Grok Imagine", "720p", "1s-15s"),
          vsub("grok-imagine-1.5", "Grok Imagine 1.5", "720p", "1s-15s"),
          {
            // The edit entry carries a description instead of chips.
            ...vsub("grok-imagine-edit", "Grok Imagine Edit", "720p", "1s-15s"),
            description: "Edit videos with text prompts",
            hideResolution: true,
            hideDuration: true,
          },
        ],
      ),
      vfeat("happyhorse", "HappyHorse", HappyHorseIcon, "1080p", "3s-15s", undefined, true),
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
  soul2: M("higgsfield-soul-2", "Cinefield Soul 2.0", "Photoreal portrait engine", Sparkles, { badge: "TOP" }),
  soulCinema: M("higgsfield-soul-cinema", "Cinefield Soul Cinema", "Cinematic character stills", Sparkles),
  gpt2: M("gpt-image-2", "GPT Image 2", "4K images with near-perfect text rendering", OpenAIIcon, { resolution: "4K", badge: "NEW" }),
  seedream45: M("seedream-4-5", "Seedream 4.5", "Balanced quality & speed", SeedreamIcon, { resolution: "4K", badge: "PREMIUM", isAdded: true }),
  seedream5pro: M("seedream-5-pro", "Seedream 5.0 Pro", "Logically consistent images with intelligent visual reasoning", SeedreamIcon, { badge: "NEW", isAdded: true }),
  nanoPro: M("nano-banana-pro", "Nano Banana Pro", "Google's flagship generation model", GoogleIcon),
  nano2: M("nano-banana-2", "Nano Banana 2", "Fast iteration drafts", GoogleIcon, { badge: "PREMIUM" }),
  nano2lite: M("nano-banana-2-lite", "Nano Banana 2 Lite", "Lightweight generation at speed", GoogleIcon, { badge: "NEW", isAdded: true }),
  recraft: M("recraft-v4-1", "Recraft V4.1", "Photorealistic and expressive image generation", RecraftIcon, { badge: "NEW" }),
  auto: M("auto", "Auto", "Automatically pick the best model for your prompt", Wand2),
  soul: M("higgsfield-soul", "Cinefield Soul", "Original portrait engine", Sparkles, { isAdded: true }),
  faceSwap: M("higgsfield-face-swap", "Cinefield Face Swap", "Transfer a face across any image", UserRound, { isAdded: true }),
  characterSwap: M("higgsfield-character-swap", "Cinefield Character Swap", "Replace a full subject seamlessly", Users, { isAdded: true }),
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
/*                                                                      */
/* Every array below (names, order, colour values) is transcribed      */
/* verbatim from the reference's live DOM markup — none of it is       */
/* invented. Only the actual photography/video that accompanied each   */
/* item in that markup is intentionally NOT reproduced (that would be  */
/* copying another product's media assets into this one); gradient/    */
/* colour swatches derived from the same real data stand in for it.    */
/* ------------------------------------------------------------------ */

/** Film setup → Genre tab. Cyclic arc order. */
export const CINEMA40_GENRES = ["Epic", "Drama", "Noir", "Comedy", "Horror", "Action", "General"];

/** Film setup → Era tab. */
export const CINEMA40_ERAS = ["1960s", "1980s", "1990s", "2000s", "2020s", "Auto"];

export interface Cinema40TempoOption {
  name: string;
  /** Cut-length bar pattern (flex-grow values) shown under the card. */
  bars: number[];
}

/** Film setup → Tempo tab (pacing of the montage). */
export const CINEMA40_TEMPO: Cinema40TempoOption[] = [
  { name: "Single shot", bars: [10.042] },
  { name: "Auto", bars: [] },
  { name: "Chaotic", bars: [0.875, 0.708, 1.25, 0.709, 1.208, 0.708, 1.042, 1.542, 0.666, 1.334, 0.041] },
  { name: "Dynamic", bars: [1.5, 0.667, 1.541, 1.084, 1.416, 0.875, 0.917, 0.708, 1.334, 0.041] },
  { name: "Calm", bars: [2.833, 3.875, 3.334] },
];

/** Camera → Setup tab, CAMERA wheel. */
export const CINEMA40_CAMERA_BODY = ["35mm Film", "8mm Film", "DV Camcorder", "Auto", "Modern"];

/** Camera → Setup tab, LENS wheel. */
export const CINEMA40_LENS = [
  "Vintage Anamorphic",
  "Warm Vintage",
  "Halation Vintage",
  "Auto",
  "Clean Sharp",
  "Anamorphic",
];

/** Camera → Setup tab, APERTURE wheel. */
export const CINEMA40_APERTURE = ["f/11 Deep Focus", "Auto", "f/1.4 Wide Open", "f/4 Moderate"];

/**
 * Camera → Movement tab. Each entry inserts a `#Tag` into the prompt rather
 * than being "selected" — there is no active/inactive state, clicking one
 * just appends it (matching the reference: "Adds to the prompt box, or type
 * # there"). Grid order matches the reference exactly.
 */
export const CINEMA40_MOVEMENT_TAGS = [
  "Snorricam",
  "Robot arm",
  "Tilt up",
  "Rack focus",
  "Tilt down",
  "POV",
  "Pan left",
  "Crane up",
  "Pan right",
  "Crane down",
  "Side tracking",
  "Pedestal up",
  "Pedestal down",
  "Handheld",
  "Tracking",
  "Drone orbit",
  "Dolly zoom",
  "Aerial pullback",
  "Static shot",
  "Bullet time",
  "Whip pan",
  "Slow zoom in",
  "Arc left",
  "Slow zoom out",
  "Arc right",
  "Truck right",
  "Dolly in",
  "Truck left",
  "Dolly out",
  "Slider right",
  "Crush zoom",
  "Slider left",
  "Helicopter shot",
];

export interface Cinema40Palette {
  name: string;
  colors: string[];
}

/** Color palette panel. RGB values transcribed verbatim from the reference. */
export const CINEMA40_COLOR_PALETTES: Cinema40Palette[] = [
  { name: "Film colors", colors: ["rgb(67,74,51)", "rgb(34,28,17)", "rgb(97,108,82)", "rgb(146,157,143)", "rgb(219,219,223)", "rgb(176,152,108)", "rgb(132,132,101)", "rgb(114,155,206)", "rgb(65,100,149)", "rgb(107,159,150)", "rgb(207,190,128)", "rgb(157,99,55)", "rgb(154,179,173)", "rgb(197,172,157)", "rgb(47,72,102)"] },
  { name: "Lime Jam", colors: ["rgb(59,92,134)", "rgb(76,109,146)", "rgb(46,76,118)", "rgb(47,50,20)", "rgb(71,72,30)", "rgb(99,98,36)", "rgb(135,119,92)", "rgb(25,27,11)", "rgb(101,132,160)", "rgb(88,88,78)", "rgb(126,130,48)", "rgb(169,142,113)", "rgb(195,181,152)", "rgb(233,217,215)", "rgb(159,170,72)"] },
  { name: "Candy pink", colors: ["rgb(238,185,209)", "rgb(143,132,125)", "rgb(33,26,28)", "rgb(213,116,121)", "rgb(189,151,158)", "rgb(132,102,114)", "rgb(112,85,79)", "rgb(172,124,130)", "rgb(75,45,44)", "rgb(87,66,63)", "rgb(236,186,182)", "rgb(222,166,180)", "rgb(163,94,93)", "rgb(129,58,44)", "rgb(140,29,83)"] },
  { name: "Nostalgic blue", colors: ["rgb(32,69,135)", "rgb(29,60,125)", "rgb(35,79,152)", "rgb(30,27,29)", "rgb(169,50,50)", "rgb(31,48,97)", "rgb(102,124,162)", "rgb(174,108,97)", "rgb(236,225,230)", "rgb(135,54,51)", "rgb(199,150,144)", "rgb(74,100,144)"] },
  { name: "Black gloss", colors: ["rgb(4,3,2)", "rgb(117,107,96)", "rgb(14,12,9)", "rgb(71,65,60)", "rgb(61,53,47)", "rgb(181,165,148)", "rgb(131,124,117)", "rgb(105,93,80)", "rgb(28,25,21)", "rgb(45,40,35)", "rgb(88,77,67)", "rgb(137,117,91)", "rgb(160,142,125)"] },
  { name: "Static Noon", colors: ["rgb(12,12,12)", "rgb(40,41,42)", "rgb(78,79,81)", "rgb(98,98,99)", "rgb(162,89,85)", "rgb(123,123,123)", "rgb(147,149,72)", "rgb(167,167,166)", "rgb(193,194,194)", "rgb(182,198,183)", "rgb(237,237,237)", "rgb(105,72,59)"] },
  { name: "Twilight Fable", colors: ["rgb(4,6,5)", "rgb(30,79,89)", "rgb(93,70,35)", "rgb(123,93,53)", "rgb(54,121,127)", "rgb(148,128,82)", "rgb(178,162,74)", "rgb(86,175,174)", "rgb(136,178,201)", "rgb(218,197,147)", "rgb(243,244,234)", "rgb(118,64,25)"] },
  { name: "Back Row Kissing Seats", colors: ["rgb(7,4,5)", "rgb(78,19,17)", "rgb(26,67,136)", "rgb(135,80,70)", "rgb(178,106,56)", "rgb(96,121,195)", "rgb(45,167,68)", "rgb(184,152,146)", "rgb(132,110,105)", "rgb(156,205,138)", "rgb(196,199,210)", "rgb(136,25,19)"] },
  { name: "On the Other Side of the Porthole", colors: ["rgb(9,7,9)", "rgb(114,11,17)", "rgb(71,69,72)", "rgb(61,83,125)", "rgb(147,53,66)", "rgb(119,99,67)", "rgb(113,114,110)", "rgb(150,156,158)", "rgb(157,187,216)", "rgb(198,191,181)", "rgb(163,203,169)", "rgb(184,45,28)"] },
  { name: "The Emerald Ambush", colors: ["rgb(16,18,16)", "rgb(75,77,45)", "rgb(60,76,123)", "rgb(100,87,75)", "rgb(61,112,59)", "rgb(105,134,167)", "rgb(149,155,135)", "rgb(202,158,128)", "rgb(190,190,193)", "rgb(152,208,213)", "rgb(240,247,240)", "rgb(29,72,27)"] },
  { name: "Highway Standoff", colors: ["rgb(13,17,12)", "rgb(54,70,63)", "rgb(105,53,26)", "rgb(99,90,57)", "rgb(33,92,167)", "rgb(96,119,101)", "rgb(134,118,96)", "rgb(155,156,133)", "rgb(190,179,137)", "rgb(173,199,174)", "rgb(238,230,194)", "rgb(15,28,121)"] },
  { name: "The Faded Fresco", colors: ["rgb(20,18,14)", "rgb(75,69,54)", "rgb(109,68,62)", "rgb(91,84,77)", "rgb(100,104,100)", "rgb(122,107,98)", "rgb(140,135,125)", "rgb(162,149,127)", "rgb(180,184,161)", "rgb(203,209,150)", "rgb(201,225,199)", "rgb(184,181,146)"] },
  { name: "Oil & Ochre", colors: ["rgb(13,13,10)", "rgb(52,38,25)", "rgb(82,70,40)", "rgb(101,78,56)", "rgb(109,105,50)", "rgb(99,105,98)", "rgb(147,137,111)", "rgb(174,164,131)", "rgb(208,166,129)", "rgb(224,208,167)", "rgb(225,220,200)", "rgb(141,121,65)"] },
  { name: "The Mountain Convent", colors: ["rgb(10,10,7)", "rgb(52,47,31)", "rgb(70,77,71)", "rgb(105,80,55)", "rgb(64,94,45)", "rgb(100,98,87)", "rgb(126,128,121)", "rgb(126,161,199)", "rgb(178,158,115)", "rgb(177,183,185)", "rgb(198,215,222)", "rgb(148,36,23)"] },
  { name: "Ghost in the Code", colors: ["rgb(4,6,5)", "rgb(27,51,29)", "rgb(102,72,54)", "rgb(60,96,82)", "rgb(105,103,71)", "rgb(129,131,128)", "rgb(146,131,99)", "rgb(106,147,135)", "rgb(184,173,154)", "rgb(191,225,200)", "rgb(230,235,233)", "rgb(99,138,99)"] },
  { name: "Pink Velvet", colors: ["rgb(13,12,15)", "rgb(104,47,29)", "rgb(32,82,121)", "rgb(124,81,68)", "rgb(48,120,163)", "rgb(153,109,115)", "rgb(127,129,141)", "rgb(210,157,159)", "rgb(221,167,128)", "rgb(215,197,200)", "rgb(239,220,213)", "rgb(159,20,11)"] },
  { name: "Two Days to the Horizon", colors: ["rgb(6,8,5)", "rgb(37,72,80)", "rgb(85,72,44)", "rgb(119,76,24)", "rgb(105,108,83)", "rgb(85,128,133)", "rgb(130,135,103)", "rgb(192,168,117)", "rgb(167,186,166)", "rgb(204,201,164)", "rgb(226,229,203)", "rgb(152,131,87)"] },
  { name: "Industrial Fog", colors: ["rgb(18,16,18)", "rgb(48,13,11)", "rgb(77,72,64)", "rgb(110,79,66)", "rgb(93,88,87)", "rgb(110,110,112)", "rgb(127,129,128)", "rgb(152,154,153)", "rgb(173,178,177)", "rgb(196,176,154)", "rgb(204,206,208)", "rgb(86,27,17)"] },
  { name: "Stairs Go Up", colors: ["rgb(5,11,14)", "rgb(61,48,31)", "rgb(55,81,51)", "rgb(80,87,77)", "rgb(112,91,68)", "rgb(85,124,118)", "rgb(159,136,101)", "rgb(135,162,144)", "rgb(76,185,163)", "rgb(190,190,155)", "rgb(178,208,181)", "rgb(129,79,33)"] },
  { name: "Field Post", colors: ["rgb(4,5,5)", "rgb(81,78,40)", "rgb(41,88,96)", "rgb(62,91,70)", "rgb(113,101,56)", "rgb(95,134,129)", "rgb(101,161,210)", "rgb(169,166,104)", "rgb(217,179,136)", "rgb(227,227,159)", "rgb(248,250,244)", "rgb(10,90,14)"] },
];

/** Lighting panel. */
export const CINEMA40_LIGHTING = ["Auto", "Silhouette", "Practicals", "Window", "Overhead fall", "Contre jour", "Soft cross"];

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
  // Only the Grok Imagine models offer these two; they are restricted to it
  // through AspectRatioDropdown's `options` prop rather than shown globally.
  // FLUX.3 Video is the only model offering 2:1.
  { value: "2:1", description: "Panorama", shape: [2, 1] },
  { value: "3:2", description: "Classic photo", shape: [3, 2] },
  { value: "2:3", description: "Portrait photo", shape: [2, 3] },
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

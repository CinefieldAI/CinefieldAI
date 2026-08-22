"use client";

import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Diamond,
  Film,
  ImageIcon,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  LockKeyhole,
  LockOpen,
  Music2,
  Move3d,
  Pencil,
  Plus,
  RectangleHorizontal,
  Search,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementType,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import VideoAssetsPicker from "./VideoAssetsPicker";
import {
  FluxIcon,
  GoogleIcon,
  GrokIcon,
  HappyHorseIcon,
  KlingIcon,
  MinimaxIcon,
  OpenAISoraIcon,
  SeedanceIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";

export type StandaloneVideoWorkflow =
  | "create-video"
  | "edit-video"
  | "motion-control";

interface WorkflowModel {
  id: string;
  name: string;
  description: string;
  icon: ElementType;
  badge?: "NEW" | "EXCLUSIVE" | "COMING_SOON";
  badgeTone?: "brand" | "danger";
  iconTone?: "default" | "brand" | "danger";
  panel?: "default" | "motion-control" | "omni-edit";
  available?: boolean;
  disabled?: boolean;
  quality?: string;
  duration?: string;
  audio?: boolean;
}

interface WorkflowModelGroup {
  name: string;
  description: string;
  icon: ElementType;
  modelNames: string[];
}

const FEATURED_CREATE_MODELS: WorkflowModel[] = [
  {
    id: "seedance-2.5",
    name: "Seedance 2.5",
    description: "Cinematic video with references",
    icon: SeedanceIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "4s-30s",
  },
  {
    // Edit-homed model surfacing in Create's Featured list too (audit
    // section 6 row 1): picking it here jumps to the Edit Video tab.
    id: "seedance-2.5-edit",
    name: "Seedance 2.5 Edit",
    description: "Edit an existing video with a prompt",
    icon: SeedanceIcon,
    badge: "NEW",
  },
  {
    id: "seedance-2.0",
    name: "Seedance 2.0",
    description: "Native cinematic video generation",
    icon: SeedanceIcon,
    quality: "4K",
    duration: "4s-15s",
  },
  {
    id: "seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    description: "Fast compact Seedance generation",
    icon: SeedanceIcon,
    badge: "NEW",
    quality: "720p",
    duration: "4s-15s",
  },
  {
    id: "seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    description: "Speed-optimized video generation",
    icon: SeedanceIcon,
    quality: "720p",
    duration: "4s-15s",
  },
  {
    id: "gemini-omni-flash",
    name: "Gemini Omni Flash",
    description: "Google multimodal video generation",
    icon: GoogleIcon,
    badge: "NEW",
    quality: "720p",
    duration: "4s-10s",
  },
  {
    id: "flux-3-video",
    name: "FLUX.3 Video",
    description: "Frame-referenced video generation",
    icon: FluxIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "5s-20s",
    audio: true,
  },
  {
    id: "cinematic-studio-video-3.5",
    name: "Cinematic Studio Video 3.5",
    description: "Director-grade cinematic controls",
    icon: WandSparkles,
    badge: "NEW",
    quality: "1080p",
    duration: "4s-15s",
  },
  {
    id: "kling-3.0",
    name: "Kling 3.0",
    description: "Cinematic videos with audio",
    icon: KlingIcon,
    quality: "4K",
    duration: "3s-15s",
    audio: true,
  },
  {
    id: "kling-3.0-turbo",
    name: "Kling 3.0 Turbo",
    description: "Faster generation with native audio",
    icon: KlingIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "3s-15s",
    audio: true,
  },
  {
    id: "kling-3.0-motion-control",
    name: "Kling 3.0 Motion Control",
    description: "Transfer motion from video to image",
    icon: KlingIcon,
    quality: "1080p",
    duration: "3s-30s",
  },
  {
    id: "happyhorse",
    name: "HappyHorse",
    description: "Fast stylized motion with audio",
    icon: HappyHorseIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "3s-15s",
    audio: true,
  },
  {
    id: "grok-imagine",
    name: "Grok Imagine",
    description: "Expressive video generation",
    icon: GrokIcon,
    quality: "720p",
    duration: "1s-15s",
  },
  {
    id: "sora-2",
    name: "Sora 2",
    description: "OpenAI's most advanced video model",
    icon: OpenAISoraIcon,
    quality: "1080p",
    duration: "4s-12s",
  },
  {
    id: "google-veo-3.1-lite",
    name: "Google Veo 3.1 Lite",
    description: "Fast video generation by Google",
    icon: GoogleIcon,
    quality: "720p",
    duration: "4s-8s",
  },
  {
    id: "google-veo-3.1",
    name: "Google Veo 3.1",
    description: "Advanced AI video with sound",
    icon: GoogleIcon,
    quality: "1080p",
    duration: "4s-8s",
    audio: true,
  },
  {
    id: "wan-2.7",
    name: "Wan 2.7",
    description: "AI video generation with frame control",
    icon: WanIcon,
    quality: "1080p",
    duration: "5s-10s",
  },
  {
    id: "minimax-h3",
    name: "MiniMax H3",
    description: "Reference-driven video generation",
    icon: MinimaxIcon,
    badge: "NEW",
    quality: "2K",
    duration: "5s-15s",
  },
  {
    id: "minimax-hailuo-2.3",
    name: "Minimax Hailuo 2.3",
    description: "Fastest high-dynamic video",
    icon: MinimaxIcon,
    quality: "1080p",
    duration: "6s-10s",
  },
  {
    id: "seedance-1.5-pro",
    name: "Seedance 1.5 Pro",
    description: "Pro-grade audio-visual sync",
    icon: SeedanceIcon,
    quality: "1080p",
    duration: "4s-12s",
    audio: true,
  },
  {
    id: "higgsfield-dop",
    name: "🚫 Cinefield DOP",
    description: "VFX and camera control",
    icon: Clapperboard,
    quality: "1080p",
    duration: "3s-10s",
  },
];

// The reference's Edit Video / Motion Control picker is a single flat
// "All models" list of exactly these 12 entries, in this order. The
// Seedance 2.5 / 2.0 / 2.0 Mini / 2.0 Fast rows are the Create-homed
// models surfacing here too (they show quality/duration chips, not a
// description line, matching the reference's rows).
const EDIT_MODELS: WorkflowModel[] = [
  {
    id: "gemini-omni-flash-edit",
    name: "Gemini Omni Flash",
    description: "Edit videos with images and prompts",
    icon: GoogleIcon,
    badge: "NEW",
  },
  {
    id: "seedance-2.5",
    name: "Seedance 2.5",
    description: "Cinematic video with references",
    icon: SeedanceIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "4s-30s",
  },
  {
    id: "seedance-2.5-edit",
    name: "Seedance 2.5 Edit",
    description: "Edit an existing video with a prompt",
    icon: SeedanceIcon,
    badge: "NEW",
  },
  {
    id: "seedance-2.0",
    name: "Seedance 2.0",
    description: "Native cinematic video generation",
    icon: SeedanceIcon,
    quality: "4K",
    duration: "4s-15s",
  },
  {
    id: "seedance-2.0-mini",
    name: "Seedance 2.0 Mini",
    description: "Fast compact Seedance generation",
    icon: SeedanceIcon,
    quality: "720p",
  },
  {
    id: "seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    description: "Speed-optimized video generation",
    icon: SeedanceIcon,
    quality: "720p",
  },
  {
    id: "higgsfield-reframe",
    name: "🚫 Cinefield Reframe",
    description: "Reframe and resize videos to any aspect ratio",
    icon: WandSparkles,
  },
  {
    id: "kling-3.0-omni-edit",
    name: "Kling 3.0 Omni Edit",
    description: "Edit videos with text prompts",
    icon: KlingIcon,
    badge: "EXCLUSIVE",
    badgeTone: "brand",
    iconTone: "brand",
    panel: "omni-edit",
    available: true,
  },
  {
    id: "kling-o1-video-edit",
    name: "Kling O1 Video Edit",
    description: "Generate with elements and references",
    icon: KlingIcon,
    badge: "COMING_SOON",
    badgeTone: "danger",
    iconTone: "danger",
    available: false,
    disabled: true,
  },
  {
    id: "kling-motion-control",
    name: "Kling Motion Control",
    description: "Control motion with video references",
    icon: KlingIcon,
    panel: "motion-control",
    available: true,
  },
  {
    id: "kling-3.0-motion-control",
    name: "Kling 3.0 Motion Control",
    description: "Transfer motion from video to image",
    icon: KlingIcon,
    panel: "motion-control",
    available: true,
  },
  {
    id: "grok-imagine-edit",
    name: "Grok Imagine Edit",
    description: "Edit videos with text prompts",
    icon: GrokIcon,
  },
];

const MOTION_CONTROL_MODELS: WorkflowModel[] = EDIT_MODELS;

const CREATE_MODEL_GROUPS: WorkflowModelGroup[] = [
  {
    name: "Minimax Hailuo",
    description: "High-dynamic, VFX-ready, fastest and most affordable",
    icon: MinimaxIcon,
    modelNames: [
      "MiniMax H3",
      "Minimax Hailuo 2.3 Fast",
      "Minimax Hailuo 2.3",
      "Minimax Hailuo 02 Fast",
      "Minimax Hailuo 02",
    ],
  },
  {
    name: "Kling",
    description: "Perfect motion with advanced video control",
    icon: KlingIcon,
    modelNames: [
      "Kling 3.0",
      "Kling 3.0 Turbo",
      "Kling 3.0 Omni",
      "Kling 3.0 Omni Edit",
      "Kling 2.6",
      "Kling O1 Video",
      "Kling O1 Video Edit",
      "Kling Motion Control",
    ],
  },
  {
    name: "OpenAI Sora 2",
    description: "Multi-shot video with sound generation",
    icon: OpenAISoraIcon,
    modelNames: ["Sora 2", "Sora 2 Pro", "Sora 2 Max", "Sora 2 Pro Max"],
  },
  {
    name: "Google Veo",
    description: "Precision video with sound control",
    icon: GoogleIcon,
    modelNames: [
      "Google Veo 3.1 Lite",
      "Google Veo 3.1 Fast",
      "Google Veo 3.1",
      "Google Veo 3 Fast",
      "Google Veo 3",
    ],
  },
  {
    name: "Gemini Omni Flash",
    description: "Google multimodal video generation",
    icon: GoogleIcon,
    modelNames: ["Gemini Omni Flash"],
  },
  {
    name: "FLUX.3 Video",
    description: "Frame-referenced video generation",
    icon: FluxIcon,
    modelNames: ["FLUX.3 Video"],
  },
  {
    name: "🚫 Cinefield",
    description: "Advanced camera controls and effect presets",
    icon: Clapperboard,
    modelNames: [
      "Cinematic Studio Video 3.5",
      "🚫 Cinefield Lite",
      "🚫 Cinefield Standard",
      "🚫 Cinefield Turbo",
    ],
  },
  {
    name: "Wan",
    description: "Camera-controlled video with sound, more freedom",
    icon: WanIcon,
    modelNames: [
      "Wan 2.7",
      "Wan 2.6",
      "Wan 2.5",
      "Wan 2.5 Fast",
      "Wan 2.2",
      "Wan 2.2 Fast",
    ],
  },
  {
    name: "Seedance",
    description: "Cinematic, multi-shot video creation",
    icon: SeedanceIcon,
    modelNames: [
      "Seedance 2.5",
      "Seedance 2.0 Fast",
      "Seedance 2.0 Mini",
      "Seedance 2.0",
      "Seedance 1.5 Pro",
      "Seedance Pro",
      "Seedance Pro Fast",
    ],
  },
  {
    name: "Grok Imagine",
    description: "Perfect motion with advanced video control",
    icon: GrokIcon,
    modelNames: ["Grok Imagine", "Grok Imagine 1.5", "Grok Imagine Edit"],
  },
  {
    name: "HappyHorse",
    description: "Fast stylized motion with audio",
    icon: HappyHorseIcon,
    modelNames: ["HappyHorse"],
  },
];

const ADDITIONAL_CREATE_MODELS: WorkflowModel[] = [
  { id: "minimax-hailuo-2.3-fast", name: "Minimax Hailuo 2.3 Fast", description: "Fast Hailuo generation", icon: MinimaxIcon, quality: "1080p", duration: "6s-10s" },
  { id: "minimax-hailuo-02-fast", name: "Minimax Hailuo 02 Fast", description: "Efficient Hailuo generation", icon: MinimaxIcon, quality: "512p", duration: "6s-10s" },
  { id: "minimax-hailuo-02", name: "Minimax Hailuo 02", description: "High-quality Hailuo generation", icon: MinimaxIcon, quality: "1080p", duration: "6s-10s" },
  { id: "kling-3.0-omni", name: "Kling 3.0 Omni", description: "Omni video generation", icon: KlingIcon, quality: "4K", duration: "3s-15s", audio: true },
  { id: "kling-3.0-omni-edit", name: "Kling 3.0 Omni Edit", description: "Omni video editing", icon: KlingIcon, quality: "1080p", duration: "3s-10s" },
  { id: "kling-2.6", name: "Kling 2.6", description: "Kling video generation", icon: KlingIcon, quality: "1080p", duration: "5s-10s", audio: true },
  { id: "kling-o1-video", name: "Kling O1 Video", description: "Kling O1 video generation", icon: KlingIcon, quality: "1080p", duration: "5s-10s" },
  { id: "kling-o1-video-edit", name: "Kling O1 Video Edit", description: "Kling O1 video editing", icon: KlingIcon, badge: "COMING_SOON", badgeTone: "danger", iconTone: "danger", available: false, disabled: true, quality: "1080p", duration: "3s-10s" },
  { id: "kling-motion-control", name: "Kling Motion Control", description: "Control motion with references", icon: KlingIcon },
  { id: "sora-2-pro", name: "Sora 2 Pro", description: "Professional Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { id: "sora-2-max", name: "Sora 2 Max", description: "Maximum-quality Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { id: "sora-2-pro-max", name: "Sora 2 Pro Max", description: "Premium Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { id: "google-veo-3.1-fast", name: "Google Veo 3.1 Fast", description: "Fast Veo 3.1 generation", icon: GoogleIcon, quality: "1080p", duration: "4s-8s", audio: true },
  { id: "google-veo-3-fast", name: "Google Veo 3 Fast", description: "Fast Veo 3 generation", icon: GoogleIcon, quality: "1080p", duration: "8s", audio: true },
  { id: "google-veo-3", name: "Google Veo 3", description: "Google video generation", icon: GoogleIcon, quality: "1080p", duration: "8s", audio: true },
  { id: "higgsfield-lite", name: "🚫 Cinefield Lite", description: "Lightweight cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { id: "higgsfield-standard", name: "🚫 Cinefield Standard", description: "Standard cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { id: "higgsfield-turbo", name: "🚫 Cinefield Turbo", description: "Fast cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { id: "wan-2.6", name: "Wan 2.6", description: "Wan video generation", icon: WanIcon, quality: "1080p", duration: "5s-15s" },
  { id: "wan-2.5", name: "Wan 2.5", description: "Wan video generation", icon: WanIcon, quality: "1080p", duration: "5s-10s" },
  { id: "wan-2.5-fast", name: "Wan 2.5 Fast", description: "Fast Wan generation", icon: WanIcon, quality: "1080p", duration: "5s-10s" },
  { id: "wan-2.2", name: "Wan 2.2", description: "Wan video generation", icon: WanIcon, quality: "720p", duration: "5s" },
  { id: "wan-2.2-fast", name: "Wan 2.2 Fast", description: "Fast Wan generation", icon: WanIcon, quality: "720p", duration: "5s" },
  { id: "seedance-pro", name: "Seedance Pro", description: "Professional Seedance generation", icon: SeedanceIcon, quality: "1080p", duration: "5s-10s" },
  { id: "seedance-pro-fast", name: "Seedance Pro Fast", description: "Fast professional Seedance generation", icon: SeedanceIcon, quality: "1080p", duration: "5s-10s" },
  { id: "grok-imagine-1.5", name: "Grok Imagine 1.5", description: "Expressive Grok generation", icon: GrokIcon, badge: "NEW", quality: "720p", duration: "1s-15s" },
  { id: "grok-imagine-edit", name: "Grok Imagine Edit", description: "Edit videos with text prompts", icon: GrokIcon },
];

const CREATE_MODELS: WorkflowModel[] = [
  ...FEATURED_CREATE_MODELS,
  ...ADDITIONAL_CREATE_MODELS,
];

const WORKFLOWS: {
  value: StandaloneVideoWorkflow;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "create-video", label: "Create Video", icon: Film },
  { value: "edit-video", label: "Edit Video", icon: Scissors },
  { value: "motion-control", label: "Motion Control", icon: Move3d },
];

const DEFAULT_MODEL_INDEX: Record<StandaloneVideoWorkflow, number> = {
  // Reference default: Cinefield Standard with the Cinefield DoP preset.
  "create-video": Math.max(
    0,
    CREATE_MODELS.findIndex((model) => model.id === "higgsfield-standard"),
  ),
  // Reference: the Edit Video tab auto-selects Seedance 2.5 Edit.
  "edit-video": Math.max(
    0,
    EDIT_MODELS.findIndex((model) => model.id === "seedance-2.5-edit"),
  ),
  // Reference: the Motion Control tab auto-selects Kling 3.0 Motion Control.
  "motion-control": Math.max(
    0,
    MOTION_CONTROL_MODELS.findIndex(
      (model) => model.id === "kling-3.0-motion-control",
    ),
  ),
};

type SeedanceModelCapabilities = {
  mediaTypes: Array<"image" | "video" | "audio">;
  duration: boolean;
  aspectRatio: boolean;
  resolution: boolean;
  bitrate: boolean;
  audioToggle: boolean;
};

type GeminiOmniFlashCapabilities = {
  inputModes: Array<"elements" | "frames">;
  elementsMediaTypes: Array<"image" | "video">;
  frameMediaTypes: Array<"image">;
  prompt: boolean;
  duration: {
    enabled: boolean;
    min: number;
    max: number;
    default: number;
  };
  aspectRatio: {
    enabled: boolean;
    options: string[];
    default: string;
  };
  resolution: false;
  bitrate: false;
  audioToggle: false;
};

const SEEDANCE_MODEL_CAPABILITIES: Record<
  string,
  SeedanceModelCapabilities
> = {
  "Seedance 2.0": {
    mediaTypes: ["image", "video", "audio"],
    duration: true,
    aspectRatio: true,
    resolution: true,
    bitrate: true,
    audioToggle: true,
  },
  "Seedance 2.0 Fast": {
    mediaTypes: ["image", "video", "audio"],
    duration: true,
    aspectRatio: true,
    resolution: true,
    bitrate: true,
    audioToggle: true,
  },
  "Seedance 2.0 Mini": {
    mediaTypes: ["image", "video", "audio"],
    duration: true,
    aspectRatio: true,
    resolution: true,
    bitrate: false,
    audioToggle: true,
  },
};

const GEMINI_OMNI_FLASH_CAPABILITIES: Record<
  string,
  GeminiOmniFlashCapabilities
> = {
  "Gemini Omni Flash": {
    inputModes: ["elements", "frames"],
    elementsMediaTypes: ["image", "video"],
    frameMediaTypes: ["image"],
    prompt: true,
    duration: {
      enabled: true,
      min: 8,
      max: 8,
      default: 8,
    },
    aspectRatio: {
      enabled: true,
      options: ["16:9", "9:16"],
      default: "16:9",
    },
    resolution: false,
    bitrate: false,
    audioToggle: false,
  },
};

type HappyHorseCapabilities = {
  duration: { min: number; max: number; default: number };
  aspectRatio: { options: string[]; default: string };
  resolution: { options: string[]; default: string };
};

const HAPPYHORSE_MODEL_CAPABILITIES: Record<string, HappyHorseCapabilities> = {
  HappyHorse: {
    duration: { min: 3, max: 15, default: 7 },
    aspectRatio: {
      options: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      default: "16:9",
    },
    resolution: {
      options: ["720p", "1080p"],
      default: "720p",
    },
  },
};

type GrokCapabilities = {
  presetVideo: string;
  subtitle: string;
  optionalUpload?: boolean;
  durationMode: "select" | "slider";
  durationOptions?: string[];
  durationSlider?: { min: number; max: number; default: number };
  aspectRatioOptions: string[];
  resolutionOptions: string[];
  credits: string;
};

const GROK_MODEL_CAPABILITIES: Record<string, GrokCapabilities> = {
  "Grok Imagine": {
    presetVideo: "https://static.higgsfield.ai/grok-video-preset-general.mp4",
    subtitle: "Grok",
    optionalUpload: true,
    durationMode: "select",
    durationOptions: ["1s", "3s", "6s", "9s", "12s", "15s"],
    aspectRatioOptions: ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    resolutionOptions: ["480p", "720p"],
    credits: "23",
  },
  "Grok Imagine 1.5": {
    presetVideo: "https://static.higgsfield.ai/grok-imagine-15-preset.mp4",
    subtitle: "Grok 1.5",
    optionalUpload: false,
    durationMode: "slider",
    durationSlider: { min: 2, max: 15, default: 5 },
    aspectRatioOptions: ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    resolutionOptions: ["480p", "720p"],
    credits: "22.5",
  },
};

type KlingCapabilities = {
  presetVideo: string;
  subtitle: string;
  durationSlider: { min: number; max: number; default: number };
  aspectRatioOptions: string[];
  resolutionOptions: string[];
  credits: string;
  /** Kling 3.0 uses raised dark panel; Turbo uses flat */
  surfaceStyle?: "raised" | "flat";
  /** Kling 3.0 has dual start/end frame dropzone */
  dualFrames?: boolean;
  /** Kling 3.0 has multi-shot */
  multiShot?: boolean;
};

const KLING_MODEL_CAPABILITIES: Record<string, KlingCapabilities> = {
  "Kling 3.0 Turbo": {
    presetVideo: "https://static.higgsfield.ai/kling-3.0-turbo/kling-3.0-turbo.mp4",
    subtitle: "Kling 3.0 Turbo",
    durationSlider: { min: 3, max: 15, default: 8 },
    aspectRatioOptions: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p", "1080p"],
    credits: "22.5",
    surfaceStyle: "flat",
  },
  "Kling 3.0": {
    presetVideo: "https://static.higgsfield.ai/kling-3.0/kling-3.0.mp4",
    subtitle: "Kling 3.0",
    durationSlider: { min: 3, max: 15, default: 5 },
    aspectRatioOptions: ["16:9", "9:16", "1:1"],
    resolutionOptions: ["720p", "1080p", "4K"],
    credits: "30",
    surfaceStyle: "raised",
    dualFrames: true,
    multiShot: true,
  },
};

const ASPECT_RATIO_OPTIONS = ["Auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const RESOLUTION_OPTIONS = ["480p", "720p"];
// Edit Video tab (Seedance 2.5 Edit layout): Resolution listbox 480p/720p/
// 1080p, defaulting to 1080p.
const EDIT_RESOLUTION_OPTIONS = ["480p", "720p", "1080p"];
// Cinefield Reframe (reference: Higgsfield Reframe): Ratio has NO Auto and
// defaults to 16:9; Quality is a 720p pill.
const REFRAME_RATIO_OPTIONS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const REFRAME_QUALITY_OPTIONS = ["720p"];

type CinefieldCapabilities = {
  presetName: string;
  durationOptions: string[];
  durationDefault: string;
  steps: { min: number; max: number; default: number };
  credits: string;
};

// The Cinefield family (reference: the Higgsfield family) shares one layout:
// preset figure with Mix + Change, single image upload, plain textarea,
// Enhance switch, Model row plus the square "Open advanced settings" button.
const CINEFIELD_MODEL_CAPABILITIES: Record<string, CinefieldCapabilities> = {
  "🚫 Cinefield Lite": {
    presetName: "Cinefield DoP",
    durationOptions: ["3s", "5s"],
    durationDefault: "5s",
    steps: { min: 20, max: 70, default: 20 },
    credits: "10",
  },
  "🚫 Cinefield Standard": {
    presetName: "Cinefield DoP",
    durationOptions: ["3s", "5s"],
    durationDefault: "5s",
    steps: { min: 20, max: 70, default: 20 },
    credits: "10",
  },
  "🚫 Cinefield Turbo": {
    presetName: "Cinefield DoP",
    durationOptions: ["3s", "5s"],
    durationDefault: "5s",
    steps: { min: 20, max: 70, default: 20 },
    credits: "10",
  },
  "🚫 Cinefield DOP": {
    presetName: "Cinefield DoP",
    durationOptions: ["3s", "5s"],
    durationDefault: "5s",
    steps: { min: 20, max: 70, default: 20 },
    credits: "10",
  },
};

type MinimaxH3Capabilities = {
  duration: { min: number; max: number; default: number };
  ratioOptions: string[];
  ratioDefault: string;
  staticResolution: string;
  credits: string;
};

const MINIMAX_H3_CAPABILITIES: Record<string, MinimaxH3Capabilities> = {
  "MiniMax H3": {
    duration: { min: 5, max: 15, default: 5 },
    ratioOptions: ["Auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    ratioDefault: "Auto",
    staticResolution: "2K",
    credits: "20",
  },
};

type Seedance25Capabilities = {
  duration: { min: number; max: number; default: number };
  ratioOptions: string[];
  ratioDefault: string;
  resolutionOptions: string[];
  resolutionDefault: string;
  credits: string;
  strikethroughCredits: string;
};

const SEEDANCE_25_CAPABILITIES: Record<string, Seedance25Capabilities> = {
  "Seedance 2.5": {
    duration: { min: 4, max: 30, default: 5 },
    ratioOptions: ASPECT_RATIO_OPTIONS,
    ratioDefault: "16:9",
    resolutionOptions: ["480p", "720p", "1080p"],
    resolutionDefault: "1080p",
    credits: "45",
    strikethroughCredits: "80",
  },
};

type Flux3Capabilities = {
  duration: { min: number; max: number; default: number };
  ratioOptions: string[];
  ratioDefault: string;
  resolutionOptions: string[];
  resolutionDefault: string;
  credits: string;
};

const FLUX3_VIDEO_CAPABILITIES: Record<string, Flux3Capabilities> = {
  "FLUX.3 Video": {
    duration: { min: 5, max: 20, default: 5 },
    ratioOptions: ASPECT_RATIO_OPTIONS,
    ratioDefault: "Auto",
    resolutionOptions: ["480p", "720p"],
    resolutionDefault: "720p",
    credits: "27.5",
  },
};

type Sora2Capabilities = {
  duration: { min: number; max: number; default: number };
  ratioOptions: string[];
  ratioDefault: string;
  exploreLabel: string;
  exploreHref: string;
  credits: string;
};

const SORA2_CAPABILITIES: Record<string, Sora2Capabilities> = {
  "Sora 2": {
    duration: { min: 4, max: 12, default: 12 },
    ratioOptions: ["16:9", "9:16"],
    ratioDefault: "16:9",
    exploreLabel: "Explore more about Sora 2",
    exploreHref: "/sora-2",
    credits: "29",
  },
};

const WORKFLOW_MODELS: Record<StandaloneVideoWorkflow, WorkflowModel[]> = {
  "create-video": CREATE_MODELS,
  "edit-video": EDIT_MODELS,
  "motion-control": MOTION_CONTROL_MODELS,
};

// Each model's real home tab, for models that surface in more than one
// catalog (or in another tab's flat list). The reference derives the active
// tab from the selected model's capability: picking a model whose home is a
// different tab — from Create Video's list/flyout, from the Edit/Motion flat
// list, or from search — switches the active tab to its real home instead of
// selecting it locally (e.g. Seedance 2.5 Edit from Create's Featured jumps
// to Edit Video; Kling 3.0 Motion Control from the Edit list jumps to Motion
// Control; Cinefield Reframe from the Motion list jumps to Edit Video).
const CROSS_WORKFLOW_MODEL_TARGET: Record<string, StandaloneVideoWorkflow> = {
  "gemini-omni-flash-edit": "edit-video",
  "seedance-2.5": "create-video",
  "seedance-2.5-edit": "edit-video",
  "seedance-2.0": "create-video",
  "seedance-2.0-mini": "create-video",
  "seedance-2.0-fast": "create-video",
  "higgsfield-reframe": "edit-video",
  "kling-3.0-omni-edit": "edit-video",
  "grok-imagine-edit": "edit-video",
  "kling-motion-control": "motion-control",
  "kling-3.0-motion-control": "motion-control",
  "kling-o1-video-edit": "motion-control",
};

// Reference: the selected model is remembered in localStorage so a reload
// restores the last model and (via its capability) the active tab.
const MODEL_STORAGE_KEY = "cinefield-video-selected-model";

// Hydration signal without setState-in-effect: the server snapshot is false,
// the client snapshot true, so the flip schedules exactly one re-render
// after hydration in which localStorage can be read safely.
const subscribeToNothing = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

interface GlobalModelEntry {
  model: WorkflowModel;
  workflow: StandaloneVideoWorkflow;
  index: number;
}

// Flat search index spanning all three tabs' catalogs, used so every model
// panel's search box can find any model regardless of which tab is open.
// Edit Video and Motion Control share one underlying array, so a model with
// a cross-workflow target is only listed once here (under its real target);
// its index is valid in both EDIT_MODELS and MOTION_CONTROL_MODELS since
// they're the same array reference.
const GLOBAL_MODEL_INDEX: GlobalModelEntry[] = (() => {
  const seen = new Set<string>();
  const entries: GlobalModelEntry[] = [];

  EDIT_MODELS.forEach((model, index) => {
    const target = CROSS_WORKFLOW_MODEL_TARGET[model.id] ?? "edit-video";
    // Models whose real home is Create Video (the Seedance rows the Edit
    // picker also lists) are indexed from CREATE_MODELS below — an
    // EDIT_MODELS index is not valid there.
    if (target === "create-video") return;
    entries.push({ model, workflow: target, index });
    seen.add(model.id);
  });

  CREATE_MODELS.forEach((model, index) => {
    if (seen.has(model.id)) return;
    entries.push({ model, workflow: "create-video", index });
    seen.add(model.id);
  });

  return entries;
})();

const NAVBAR_MODEL_TARGETS: Record<
  string,
  { workflow: StandaloneVideoWorkflow; modelName: string }
> = {
  "Seedance 2.0 4K": {
    workflow: "create-video",
    modelName: "Seedance 2.0",
  },
  "Kling 3.0": { workflow: "create-video", modelName: "Kling 3.0" },
  "Kling 3.0 Turbo": {
    workflow: "create-video",
    modelName: "Kling 3.0 Turbo",
  },
  "Kling 3.0 Motion Control": {
    workflow: "motion-control",
    modelName: "Kling 3.0 Motion Control",
  },
  "Kling 01 Edit": {
    workflow: "edit-video",
    modelName: "Kling O1 Video Edit",
  },
  "Sora 2": { workflow: "create-video", modelName: "Sora 2" },
  "Google Veo 3.1 Lite": {
    workflow: "create-video",
    modelName: "Google Veo 3.1 Lite",
  },
  "Google Veo 3.1": {
    workflow: "create-video",
    modelName: "Google Veo 3.1",
  },
  HappyHorse: { workflow: "create-video", modelName: "HappyHorse" },
  "Grok Imagine": {
    workflow: "create-video",
    modelName: "Grok Imagine",
  },
  "Grok Imagine 1.5": {
    workflow: "create-video",
    modelName: "Grok Imagine 1.5",
  },
  "Wan 2.7": { workflow: "create-video", modelName: "Wan 2.7" },
  "Minimax Hailuo 2.3": {
    workflow: "create-video",
    modelName: "Minimax Hailuo 2.3",
  },
  "Seedance 1.5 Pro": {
    workflow: "create-video",
    modelName: "Seedance 1.5 Pro",
  },
  "🚫 Cinefield DOP": {
    workflow: "create-video",
    modelName: "🚫 Cinefield DOP",
  },
};

function GenerateItSpan({ onGenerateIt }: { onGenerateIt: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onGenerateIt();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onGenerateIt();
      }}
      className="cursor-pointer text-[#D97757] hover:underline"
    >
      generate it
    </span>
  );
}

function UploadSurface({
  title,
  description,
  compact = false,
  icon: Icon = Upload,
  fileName: controlledFileName,
  onFileNameChange,
  accept = "image/*,video/*",
  onGenerateIt,
}: {
  title: string;
  description: string;
  compact?: boolean;
  icon?: LucideIcon;
  fileName?: string;
  onFileNameChange?: (name: string) => void;
  accept?: string;
  onGenerateIt?: () => void;
}) {
  const [internalFileName, setInternalFileName] = useState("");
  const fileName = controlledFileName ?? internalFileName;
  const updateFileName = (name: string) => {
    if (onFileNameChange) onFileNameChange(name);
    else setInternalFileName(name);
  };

  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-center transition-colors hover:border-[#D97757]/55 hover:bg-[#D97757]/[0.04] ${
        compact ? "min-h-44" : "min-h-32"
      }`}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        onChange={(event) =>
          updateFileName(event.target.files?.[0]?.name ?? "")
        }
      />
      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-zinc-300">
        {fileName ? (
          <Check className="size-4 text-[#D97757]" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="mt-2 text-xs font-semibold text-white">
        {fileName ||
          (onGenerateIt ? (
            <>
              Upload image or <GenerateItSpan onGenerateIt={onGenerateIt} />
            </>
          ) : (
            title
          ))}
      </span>
      <span className="mt-1 text-[11px] leading-4 text-zinc-500">
        {fileName ? "Ready to use" : description}
      </span>
    </label>
  );
}

function WorkflowBanner({
  workflow,
  model,
}: {
  workflow: StandaloneVideoWorkflow;
  model: WorkflowModel;
}) {
  const content = {
    "create-video": {
      title: "GENERAL",
      subtitle: model.name,
      image: "https://static.higgsfield.ai/feed/step-3-thumbnail.webp",
    },
    "edit-video": {
      title:
        model.panel === "omni-edit"
          ? "KLING 3.0 OMNI EDIT"
          : model.name.toUpperCase(),
      subtitle: model.description,
      image: "https://static.higgsfield.ai/feed/step2-thumbnail.webp",
    },
    "motion-control": {
      title: "MOTION CONTROL",
      subtitle: model.name,
      image: "https://static.higgsfield.ai/feed/step-1-v2.webp",
    },
  }[workflow];

  return (
    <div className="relative h-32 overflow-hidden rounded-xl bg-black">
      <img
        src={content.image}
        alt=""
        className="size-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
      <div className="absolute bottom-3 left-3">
        <p className="text-lg font-black text-[#D97757]">{content.title}</p>
        <p className="mt-0.5 text-xs text-zinc-300">{content.subtitle}</p>
      </div>
      <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-zinc-200 backdrop-blur-sm">
        How it works
      </span>
    </div>
  );
}

function CapabilityChip({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500">
      <Icon className="size-3" />
      {children}
    </span>
  );
}

function ModelBadgePill({
  badge,
  tone = "brand",
}: {
  badge: NonNullable<WorkflowModel["badge"]>;
  tone?: NonNullable<WorkflowModel["badgeTone"]>;
}) {
  const label = badge === "COMING_SOON" ? "Coming soon" : badge;
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[10px] font-semibold leading-none ${
        tone === "danger"
          ? "border-red-400/20 bg-red-500/10 text-red-300"
          : badge === "EXCLUSIVE"
            ? "border-[#D97757]/30 bg-[#D97757] text-black"
            : "border-[#D97757]/25 bg-[#D97757]/15 text-[#ef9a7e]"
      }`}
    >
      {label}
    </span>
  );
}

function WorkflowModelPanel({
  workflow,
  models,
  selectedIndex,
  onSelect,
  onClose,
}: {
  workflow: StandaloneVideoWorkflow;
  models: WorkflowModel[];
  selectedIndex: number;
  onSelect: (targetWorkflow: StandaloneVideoWorkflow, index: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeGroupName, setActiveGroupName] = useState<string | null>(null);
  const [flyoutPosition, setFlyoutPosition] = useState({
    left: 0,
    top: 0,
  });
  const flyoutCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const cancelFlyoutClose = () => {
    if (flyoutCloseTimerRef.current !== null) {
      clearTimeout(flyoutCloseTimerRef.current);
      flyoutCloseTimerRef.current = null;
    }
  };

  const scheduleFlyoutClose = () => {
    cancelFlyoutClose();
    flyoutCloseTimerRef.current = setTimeout(() => {
      setActiveGroupName(null);
      flyoutCloseTimerRef.current = null;
    }, 260);
  };

  useEffect(
    () => () => {
      if (flyoutCloseTimerRef.current !== null) {
        clearTimeout(flyoutCloseTimerRef.current);
      }
    },
    [],
  );
  const filtered = useMemo(
    () =>
      (workflow === "create-video"
        ? models.slice(0, FEATURED_CREATE_MODELS.length)
        : models
      )
        .map((model, index) => ({ model, index }))
        .filter(({ model }) =>
          model.name.toLowerCase().includes(search.toLowerCase()),
        ),
    [models, search, workflow],
  );
  const filteredGroups = useMemo(
    () =>
      CREATE_MODEL_GROUPS.filter((group) => {
        const query = search.toLowerCase();
        return (
          group.name.toLowerCase().includes(query) ||
          group.description.toLowerCase().includes(query) ||
          group.modelNames.some((name) => name.toLowerCase().includes(query))
        );
      }),
    [search],
  );
  const activeGroup =
    workflow === "create-video"
      ? CREATE_MODEL_GROUPS.find((group) => group.name === activeGroupName)
      : undefined;

  // Global search: active whenever the box has text, regardless of which
  // tab's panel is open — results span all three catalogs, replacing the
  // normal Featured/All models view for as long as the user is typing.
  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch.length > 0;
  const globalResults = useMemo(() => {
    if (!isSearching) return [];
    const query = trimmedSearch.toLowerCase();
    return GLOBAL_MODEL_INDEX.filter(
      ({ model }) =>
        model.name.toLowerCase().includes(query) ||
        model.description.toLowerCase().includes(query),
    );
  }, [isSearching, trimmedSearch]);

  // Selecting a model from Create Video's own list/flyout: models that
  // belong to Edit Video or Motion Control resolve to their real tab and
  // index there; everything else just selects locally within Create Video.
  const resolveCreateVideoSelection = (
    model: WorkflowModel,
    fallbackIndex: number,
  ): { workflow: StandaloneVideoWorkflow; index: number } => {
    const target = CROSS_WORKFLOW_MODEL_TARGET[model.id];
    if (target) {
      const targetIndex = WORKFLOW_MODELS[target].findIndex(
        (m) => m.id === model.id,
      );
      if (targetIndex >= 0) return { workflow: target, index: targetIndex };
    }
    return { workflow: "create-video", index: fallbackIndex };
  };

  const panelTop =
    workflow === "create-video"
      ? "top-0"
      : workflow === "edit-video"
        ? "top-[350px]"
        : "top-[175px]";

  return (
    <>
      <button
        type="button"
        aria-label="Close model panel"
        onClick={onClose}
        className="fixed inset-0 z-40 hidden bg-transparent lg:block"
      />
      <div
        className={`absolute left-[calc(100%+12px)] z-50 w-[390px] max-w-[calc(100vw-390px)] origin-left overflow-hidden rounded-2xl border border-white/10 bg-[#1d2022]/[0.98] shadow-2xl shadow-black/60 backdrop-blur-xl animate-[nm-in_160ms_ease-out] max-lg:left-0 max-lg:top-full max-lg:mt-2 max-lg:w-full max-lg:max-w-none ${panelTop}`}
      >
        <div className="flex h-12 items-center gap-2 border-b border-white/[0.07] px-3">
          <Search className="size-4 text-zinc-500" />
          <input
            autoFocus
            name="standalone-video-model-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveGroupName(null);
            }}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>
        <div className="max-h-[600px] overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!isSearching && (
          <>
          <p className="px-2 py-1.5 text-[11px] text-zinc-500">
            {workflow === "create-video" ? "Featured models" : "All models"}
          </p>
          {filtered.map(({ model, index }) => {
            const Icon = model.icon;
            const unavailable = model.disabled || model.available === false;
            const selected = !unavailable && index === selectedIndex;
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => {
                  if (unavailable) return;
                  if (workflow === "create-video") {
                    const target = resolveCreateVideoSelection(model, index);
                    onSelect(target.workflow, target.index);
                  } else {
                    // Edit/Motion flat list: the reference derives the tab
                    // from the model's capability — a model homed on another
                    // tab jumps there instead of selecting locally.
                    const target = CROSS_WORKFLOW_MODEL_TARGET[model.id];
                    if (target && target !== workflow) {
                      const targetIndex = WORKFLOW_MODELS[target].findIndex(
                        (m) => m.id === model.id,
                      );
                      if (targetIndex >= 0) {
                        onSelect(target, targetIndex);
                        return;
                      }
                    }
                    onSelect(workflow, index);
                  }
                }}
                aria-pressed={selected}
                aria-disabled={unavailable || undefined}
                disabled={unavailable}
                className={`group/model relative flex w-full items-center px-2.5 py-2 rounded-[12px] text-left transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
                  selected
                    ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                    : unavailable
                      ? "cursor-not-allowed opacity-75 bg-[rgba(255,255,255,0.015)] border border-white/[0.02]"
                      : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
                }`}
              >
                {selected && (
                  <span
                    aria-hidden
                    className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
                  />
                )}
                <div
                  className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
                    selected
                      ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
                      : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model:scale-[1.02] mr-3"
                  }`}
                  style={{
                    background:
                      "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
                  }}
                >
                  <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center overflow-hidden">
                    <Icon className="size-5 text-white" aria-hidden="true" />
                  </div>
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-xs font-semibold ${selected ? "text-white font-bold" : "text-white/90 group-hover/model:text-white"}`}>
                      {model.name}
                    </span>
                    {model.badge && (
                      <ModelBadgePill
                        badge={model.badge}
                        tone={model.badgeTone}
                      />
                    )}
                    {model.audio && (
                      <Video className="size-3.5 text-zinc-500" />
                    )}
                  </span>
                  {model.quality || model.duration ? (
                    <span className="mt-1 flex items-center gap-1">
                      {model.quality && (
                        <CapabilityChip icon={Diamond}>
                          {model.quality}
                        </CapabilityChip>
                      )}
                      {model.duration && (
                        <CapabilityChip icon={Clock3}>
                          {model.duration}
                        </CapabilityChip>
                      )}
                    </span>
                  ) : (
                    <span className="mt-0.5 block truncate text-[10px] text-white/45 group-hover/model:text-white/60">
                      {model.description}
                    </span>
                  )}
                </span>
                {unavailable ? (
                  <LockKeyhole className="size-4 shrink-0 text-red-400" />
                ) : selected ? (
                  <Check className="size-4 shrink-0 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />
                ) : null}
              </button>
            );
          })}
          {workflow === "create-video" && (
            <>
              <p className="mt-2 px-2 py-1.5 text-[11px] text-zinc-500">
                All models
              </p>
              {filteredGroups.map((group) => {
                const Icon = group.icon;
                const groupIndexes = group.modelNames
                  .map((name) => models.findIndex((model) => model.name === name))
                  .filter((index) => index >= 0);
                const selected = groupIndexes.includes(selectedIndex);
                const expandable = groupIndexes.length > 1;
                const active = activeGroupName === group.name;
                const showFlyout = (button: HTMLButtonElement) => {
                  cancelFlyoutClose();
                  const rect = button.getBoundingClientRect();
                  const estimatedHeight = Math.min(
                    520,
                    groupIndexes.length * 68 + 16,
                  );
                  setFlyoutPosition({
                    left: rect.right + 8,
                    top: Math.max(
                      8,
                      Math.min(
                        rect.top,
                        window.innerHeight - estimatedHeight - 8,
                      ),
                    ),
                  });
                  setActiveGroupName(group.name);
                };

                return (
                  <div key={group.name}>
                    <button
                      type="button"
                      aria-expanded={expandable ? active : undefined}
                      aria-pressed={!expandable ? selected : undefined}
                      onMouseEnter={(event) => {
                        if (expandable) showFlyout(event.currentTarget);
                      }}
                      onMouseLeave={() => {
                        if (expandable) scheduleFlyoutClose();
                      }}
                      onFocus={(event) => {
                        if (expandable) showFlyout(event.currentTarget);
                      }}
                      onClick={(event) => {
                        if (expandable) {
                          showFlyout(event.currentTarget);
                        } else if (groupIndexes[0] !== undefined) {
                          const target = resolveCreateVideoSelection(
                            models[groupIndexes[0]],
                            groupIndexes[0],
                          );
                          onSelect(target.workflow, target.index);
                        }
                      }}
                      className={`group/model relative flex w-full items-center px-2.5 py-2 rounded-[12px] text-left transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
                        selected || active
                          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                          : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
                      }`}
                    >
                      {(selected || active) && (
                        <span
                          aria-hidden
                          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
                        />
                      )}
                      <div
                        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
                          selected || active
                            ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
                            : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model:scale-[1.02] mr-3"
                        }`}
                        style={{
                          background:
                            "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
                        }}
                      >
                        <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center overflow-hidden">
                          <Icon className="size-5 text-white" aria-hidden="true" />
                        </div>
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className={`truncate text-xs font-semibold ${selected || active ? "text-white font-bold" : "text-white/90 group-hover/model:text-white"}`}>
                          {group.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-white/45 group-hover/model:text-white/60">
                          {group.description}
                        </span>
                      </span>
                      {expandable ? (
                        <ChevronDown
                          className="size-4 shrink-0 -rotate-90 text-zinc-500"
                        />
                      ) : selected ? (
                        <Check className="size-4 shrink-0 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </>
          )}
          </>
          )}
          {isSearching && (
            <>
              <p className="px-2 py-1.5 text-[11px] text-zinc-500">
                {globalResults.length > 0 ? "Search results" : "No models found"}
              </p>
              {globalResults.map(({ model, workflow: entryWorkflow, index }) => {
                const Icon = model.icon;
                const unavailable =
                  model.disabled || model.available === false;
                const selected =
                  !unavailable &&
                  entryWorkflow === workflow &&
                  index === selectedIndex;
                const crossTab = entryWorkflow !== workflow;
                const targetLabel = WORKFLOWS.find(
                  (w) => w.value === entryWorkflow,
                )?.label;
                return (
                  <button
                    key={`${entryWorkflow}-${model.id}`}
                    type="button"
                    onClick={() => {
                      if (!unavailable) onSelect(entryWorkflow, index);
                    }}
                    aria-pressed={selected}
                    aria-disabled={unavailable || undefined}
                    disabled={unavailable}
                    className={`group/model flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-all duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      selected
                        ? "bg-white/[0.07]"
                        : unavailable
                          ? "cursor-not-allowed opacity-75"
                          : "hover:bg-white/[0.04] hover:-translate-y-[1px] hover:scale-[1.006]"
                    }`}
                  >
                    <div
                      className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
                        selected
                          ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)]"
                          : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)]"
                      }`}
                      style={{
                        background:
                          "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
                      }}
                    >
                      <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center overflow-hidden">
                        <Icon className="size-5 text-white" aria-hidden="true" />
                      </div>
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[16px] font-semibold leading-5 text-white">
                          {model.name}
                        </span>
                        {model.badge && (
                          <ModelBadgePill
                            badge={model.badge}
                            tone={model.badgeTone}
                          />
                        )}
                        {model.audio && (
                          <Video className="size-3.5 text-zinc-500" />
                        )}
                      </span>
                      {entryWorkflow === "create-video" ? (
                        <span className="mt-1 flex items-center gap-1">
                          {model.quality && (
                            <CapabilityChip icon={Diamond}>
                              {model.quality}
                            </CapabilityChip>
                          )}
                          {model.duration && (
                            <CapabilityChip icon={Clock3}>
                              {model.duration}
                            </CapabilityChip>
                          )}
                          {crossTab && targetLabel && (
                            <span className="text-[10px] text-zinc-500">
                              in {targetLabel}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500">
                          {model.description}
                          {crossTab && targetLabel && (
                            <span className="shrink-0 text-[10px] text-zinc-600">
                              · {targetLabel}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    {unavailable ? (
                      <LockKeyhole className="size-4 shrink-0 text-red-400" />
                    ) : selected ? (
                      <Check className="size-4 shrink-0 text-[#D97757]" />
                    ) : null}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
      {activeGroup && (
        <div
          onMouseEnter={cancelFlyoutClose}
          onMouseLeave={scheduleFlyoutClose}
          className="fixed z-[60] w-[310px] max-w-[calc(100vw-16px)] origin-left overflow-y-auto rounded-2xl border border-white/10 bg-[#1d2022]/[0.99] p-2 shadow-2xl shadow-black/60 backdrop-blur-xl animate-[nm-in_160ms_ease-out] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            left: flyoutPosition.left,
            top: flyoutPosition.top,
            maxHeight: "min(520px, calc(100vh - 16px))",
          }}
        >
          {activeGroup.modelNames.map((name) => {
            const index = models.findIndex((model) => model.name === name);
            if (index < 0) return null;

            const model = models[index];
            const unavailable = model.disabled || model.available === false;
            const selected = !unavailable && index === selectedIndex;
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => {
                  if (unavailable) return;
                  cancelFlyoutClose();
                  setActiveGroupName(null);
                  const target = resolveCreateVideoSelection(model, index);
                  onSelect(target.workflow, target.index);
                }}
                aria-pressed={selected}
                aria-disabled={unavailable || undefined}
                disabled={unavailable}
                className={`relative w-full rounded-xl px-3 py-2.5 pr-9 text-left transition-all duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  selected
                    ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
                    : unavailable
                      ? "cursor-not-allowed opacity-75"
                      : "hover:bg-white/[0.04] hover:-translate-y-[1px] hover:scale-[1.006]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[16px] font-semibold leading-5 text-white">
                    {model.name}
                  </span>
                  {model.badge && (
                    <ModelBadgePill
                      badge={model.badge}
                      tone={model.badgeTone}
                    />
                  )}
                  {model.audio && (
                    <Video className="size-3.5 shrink-0 text-zinc-500" />
                  )}
                </span>
                {(model.quality || model.duration) && (
                  <span className="mt-1 flex items-center gap-1">
                    {model.quality && (
                      <CapabilityChip icon={Diamond}>
                        {model.quality}
                      </CapabilityChip>
                    )}
                    {model.duration && (
                      <CapabilityChip icon={Clock3}>
                        {model.duration}
                      </CapabilityChip>
                    )}
                  </span>
                )}
                {unavailable ? (
                  <LockKeyhole className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-red-400" />
                ) : selected ? (
                  <Check className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ModelTrigger({
  model,
  open,
  onClick,
}: {
  model: WorkflowModel;
  open?: boolean;
  onClick: () => void;
}) {
  const Icon = model.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ease-out ${
        open
          ? "border-[#D97757] bg-white/[0.06] shadow-[0_0_12px_rgba(217,119,87,0.30)]"
          : "border-white/[0.07] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[10px] text-zinc-500">Model</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-white">
            {model.name}
          </span>
          <Icon className="size-4 shrink-0 text-[#D97757]" />
        </span>
      </span>
      <ChevronDown
        className={`size-4 transition-transform duration-200 ease-out ${
          open ? "rotate-180 text-[#D97757]" : "text-zinc-400"
        }`}
      />
    </button>
  );
}

function SeedanceBanner({
  modelName,
  presetName = "General",
  onChangeClick,
}: {
  modelName: string;
  /** Preset chosen in the preset selector; "General" until one is picked. */
  presetName?: string;
  onChangeClick?: () => void;
}) {
  return (
    <div className="relative h-32 overflow-hidden rounded-xl bg-black">
      <img
        src="https://static.higgsfield.ai/feed/step-3-thumbnail.webp"
        alt=""
        className="size-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
      <button
        type="button"
        onClick={onChangeClick}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-zinc-200 backdrop-blur-sm"
      >
        <Pencil className="size-3" />
        Change
      </button>
      <div className="absolute bottom-3 left-3">
        <p className="truncate text-lg font-black uppercase text-[#D97757]">
          {presetName}
        </p>
        <p className="mt-0.5 text-xs text-zinc-300">{modelName}</p>
      </div>
    </div>
  );
}

function SeedanceMediaUpload({
  selected,
  onClick,
  title = "Add references",
  helper = "Image, Video or Audio",
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  helper?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-4 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]"
    >
      <span aria-hidden="true" className="flex h-10 items-center justify-center">
        <span className="-mr-1 flex size-9 -rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
          <ImageIcon className="size-3 text-zinc-300" />
        </span>
        <span className="relative z-10 flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.09] shadow-inner">
          {selected ? (
            <Check className="size-3.5 text-[#D97757]" />
          ) : (
            <Video className="size-3 text-zinc-200" />
          )}
        </span>
        <span className="-ml-1 flex size-9 rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
          <Music2 className="size-3 text-zinc-300" />
        </span>
      </span>
      <span className="mt-2 text-xs font-medium text-zinc-300">{title}</span>
      <span className="mt-1 text-[11px] font-medium text-zinc-500">
        {selected ? "Ready to use" : helper}
      </span>
    </button>
  );
}

function AssetsCardButton({
  title,
  helper,
  icon: Icon = Plus,
  selected = false,
  onClick,
}: {
  title: string;
  helper: string;
  icon?: LucideIcon;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-4 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]"
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner"
      >
        {selected ? (
          <Check className="size-4 text-[#D97757]" />
        ) : (
          <Icon className="size-4 text-zinc-300" />
        )}
      </span>
      <span className="mt-2 text-xs font-medium text-zinc-300">{title}</span>
      <span className="mt-1 text-[11px] font-medium text-zinc-500">
        {selected ? "Ready to use" : helper}
      </span>
    </button>
  );
}

// Gradient stand-in for the reference's preset preview media — the project
// deliberately does not download the reference's photography/video.
const PRESET_FIGURE_GRADIENT =
  "linear-gradient(135deg, #3a2a22 0%, #23201d 45%, #101113 100%)";

function PresetFigure({
  subtitle,
  presetName = "General",
  showMix = false,
  onOpenPresetSelector,
  clickable = false,
}: {
  subtitle: string;
  /** Preset chosen in the preset selector; "General" until one is picked. */
  presetName?: string;
  showMix?: boolean;
  onOpenPresetSelector?: (mode: "change" | "mix") => void;
  clickable?: boolean;
}) {
  return (
    <figure
      className="relative aspect-[2.3] w-full select-none overflow-hidden rounded-xl group"
      tabIndex={clickable ? 0 : -1}
      role="button"
      onClick={clickable ? () => onOpenPresetSelector?.("change") : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpenPresetSelector?.("change");
            }
          : undefined
      }
    >
      <div
        aria-hidden="true"
        className="size-full rounded-md"
        style={{ background: PRESET_FIGURE_GRADIENT }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 50%)",
        }}
      />
      <figcaption className="absolute bottom-0 left-0 z-10 w-full pb-3 pl-3 pr-1.5">
        <p className="w-full truncate text-lg font-black uppercase text-[#D97757]">
          {presetName}
        </p>
        <p className="text-xs text-white/80">{subtitle}</p>
      </figcaption>
      {/* On the clickable (Cinefield) card the buttons start
          pointer-events:none so a non-hover tap falls through to the figure
          (same action); group-hover re-enables them. */}
      <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
        {showMix && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPresetSelector?.("mix");
            }}
            className={`${
              clickable
                ? "pointer-events-none group-hover:pointer-events-auto "
                : ""
            }inline-flex h-6 items-center gap-1 rounded-lg border border-white/[0.06] bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-[#D97757] hover:text-black`}
          >
            <Sparkles className="size-3.5" />
            Mix
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenPresetSelector?.("change");
          }}
          className={`${
            clickable
              ? "pointer-events-none group-hover:pointer-events-auto "
              : ""
          }inline-flex h-6 items-center gap-1 rounded-lg border border-white/[0.06] bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-[#D97757] hover:text-black`}
        >
          <Pencil className="size-3.5" />
          Change
        </button>
      </div>
    </figure>
  );
}

function SeedancePromptCard({
  prompt,
  onPromptChange,
  audioEnabled = false,
  onAudioEnabledChange,
  onElementsClick,
  showAudioToggle = false,
  showElements = true,
  toggleVariant = "audio",
  placeholder = "Describe your scene in detail. Use @ to reference assets",
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  audioEnabled?: boolean;
  onAudioEnabledChange?: (value: boolean) => void;
  onElementsClick?: () => void;
  showAudioToggle?: boolean;
  showElements?: boolean;
  /** "audio" renders volume icons; "enhance" renders the wand icon */
  toggleVariant?: "audio" | "enhance";
  placeholder?: string;
}) {
  const ToggleIcon =
    toggleVariant === "enhance"
      ? WandSparkles
      : audioEnabled
        ? Volume2
        : VolumeX;
  const hasElements = showElements && Boolean(onElementsClick);
  const hasToggle = showAudioToggle && Boolean(onAudioEnabledChange);
  return (
    <div className="flex min-h-[142px] flex-col rounded-xl bg-white/[0.035] p-3">
      <label htmlFor="standalone-seedance-prompt" className="text-xs font-semibold text-zinc-300">
        Prompt
      </label>
      <textarea
        id="standalone-seedance-prompt"
        name="standalone-seedance-prompt"
        rows={3}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-0 flex-1 resize-none bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
      />
      {(hasElements || hasToggle) && (
        <div className="mt-2 flex items-center gap-2">
          {hasElements && (
            <button
              type="button"
              onClick={onElementsClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#131517] px-1.5 py-1 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06]"
            >
              <AtSign className="size-3" />
              Elements
            </button>
          )}
          {hasToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={audioEnabled}
              onClick={() => onAudioEnabledChange?.(!audioEnabled)}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-[#131517] px-1.5 py-1 text-xs font-semibold ${
                audioEnabled ? "text-white" : "text-zinc-500"
              }`}
            >
              <ToggleIcon className="size-3" />
              {audioEnabled ? "On" : "Off"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SegmentModeSwitch<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid grid-cols-2 rounded-xl bg-white/[0.035] p-1"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const nextIndex =
              event.key === "ArrowRight"
                ? (index + 1) % options.length
                : (index - 1 + options.length) % options.length;
            onChange(options[nextIndex].value);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]',
              );
            buttons?.[nextIndex]?.focus({ preventScroll: true });
          }}
          className={`h-9 rounded-lg text-sm font-semibold transition-colors ${
            value === option.value
              ? "bg-white/10 text-white"
              : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GeminiElementsInput({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="grid rounded-[20px] border border-white/[0.07] p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <button
        type="button"
        onClick={onClick}
        aria-label="Choose image or video media"
        className="flex min-h-[132px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#1b1d1f] p-3 text-center transition-colors hover:bg-white/[0.035]"
      >
        <span aria-hidden="true" className="flex h-10 items-center justify-center">
          <span className="-mr-1 flex size-9 -rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
            <ImageIcon className="size-3 text-zinc-300" />
          </span>
          <span className="flex size-9 rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.09] shadow-inner">
            {selected ? (
              <Check className="size-3.5 text-[#D97757]" />
            ) : (
              <Video className="size-3 text-zinc-200" />
            )}
          </span>
        </span>
        <span className="mt-2 text-sm font-medium text-zinc-400">
          Add references
        </span>
        <span className="mt-1 text-[11px] font-medium text-zinc-500">
          Image or Video
        </span>
      </button>
    </div>
  );
}

function GeminiFramesInput({
  startSelected,
  endSelected,
  onStartClick,
  onEndClick,
}: {
  startSelected: boolean;
  endSelected: boolean;
  onStartClick: () => void;
  onEndClick: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[20px] border border-white/[0.07] p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <GeminiFrameCard
        label="Start frame"
        selected={startSelected}
        onClick={onStartClick}
      />
      <GeminiFrameCard
        label="End frame"
        optional
        selected={endSelected}
        onClick={onEndClick}
      />
    </div>
  );
}

function GeminiFrameCard({
  label,
  optional = false,
  selected,
  onClick,
}: {
  label: string;
  optional?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Choose ${label.toLowerCase()}`}
      className="relative flex min-h-[132px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-[#1b1d1f] p-3 text-zinc-400 transition-colors hover:bg-white/[0.035]"
    >
      {optional && (
        <span className="absolute right-2 top-2 rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500">
          Optional
        </span>
      )}
      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
        {selected ? (
          <Check className="size-4 text-[#D97757]" />
        ) : (
          <ImageIcon className="size-3.5" />
        )}
      </span>
      <span className="mt-3 text-sm font-medium">{label}</span>
    </button>
  );
}

function GeminiPromptCard({
  prompt,
  onPromptChange,
  placeholder = "Describe your scene in detail. Use @ to reference media",
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mt-4 flex min-h-[160px] max-h-64 flex-col rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
      <label
        htmlFor="standalone-gemini-prompt"
        className="text-xs font-semibold text-zinc-400"
      >
        Prompt
      </label>
      <textarea
        id="standalone-gemini-prompt"
        name="standalone-gemini-prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 min-h-[112px] w-full flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
      />
    </div>
  );
}

function SeedanceSelectControl({
  label,
  value,
  options,
  icon: Icon,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  icon: LucideIcon;
  onChange: (value: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value}`}
          className="flex h-10 min-w-0 flex-1 items-center justify-between gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-semibold text-white hover:bg-white/[0.08]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-zinc-400" />
            <span className="truncate">{value}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          role="listbox"
          aria-label={label}
          className="z-[100000] min-w-[180px] rounded-xl border border-white/10 bg-[#1d2022]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          {options.map((option) => (
            <Popover.Close asChild key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => onChange(option)}
                className={`flex h-9 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-medium transition-colors ${
                  option === value
                    ? "bg-white/[0.07] text-white"
                    : "text-zinc-300 hover:bg-white/[0.04]"
                }`}
              >
                {option}
                {option === value && <Check className="size-3.5" />}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SeedanceDurationControl({
  value,
  onChange,
  min = 4,
  max = 15,
  inputName = "standalone-seedance-duration",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  inputName?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Duration: ${value} seconds`}
          className="flex h-10 min-w-0 flex-1 items-center justify-between gap-1 rounded-lg bg-white/[0.05] px-2 text-xs font-semibold text-white hover:bg-white/[0.08]"
        >
          <span className="flex items-center gap-1.5">
            <Clock3 className="size-3.5 text-zinc-400" />
            {value}s
          </span>
          <ChevronDown className="size-3.5 text-zinc-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100000] w-[334px] rounded-2xl border border-white/10 bg-[#1d2022]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <p className="px-1 pb-2 text-xs font-semibold text-zinc-300">
            Choose duration
          </p>
          <div className="rounded-xl bg-[#131517] p-2">
            <div
              className="relative flex h-9 items-center overflow-hidden rounded-md border border-[#424242] bg-[#202326] px-3 focus-within:ring-1 focus-within:ring-white/40"
              style={
                {
                  "--duration-progress": `${
                    max > min ? ((value - min) / (max - min)) * 100 : 100
                  }%`,
                } as React.CSSProperties
              }
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 bg-white/[0.045]"
                style={{ width: "var(--duration-progress)" }}
              />
              <span className="absolute left-3 text-xs font-semibold text-white">
                {value}s
              </span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-white"
                style={{ left: "var(--duration-progress)" }}
              />
              <input
                type="range"
                name={inputName}
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                aria-label="Duration in seconds"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={value}
                aria-valuetext={`${value} seconds`}
                className="absolute inset-0 size-full cursor-ew-resize opacity-0 active:cursor-grabbing"
              />
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BitrateIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-5 shrink-0 text-zinc-300"
      aria-hidden="true"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 5.5h-10a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h10m0-16v19m3-13v7m6-5v3m-3-8v13m-15-11h1m-1 9h1m2-9h1m2 0h1m-4 9h1m2 0h1"
      />
    </svg>
  );
}

function SeedanceBitrateControl({
  value,
  onChange,
}: {
  value: "High" | "Standard";
  onChange: (value: "High" | "Standard") => void;
}) {
  const options = [
    {
      value: "High" as const,
      description: "Less compression · larger size",
      icon: Sparkles,
    },
    {
      value: "Standard" as const,
      description: "More compression · smaller size",
      icon: Zap,
    },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md bg-white/[0.05] px-3 text-xs font-semibold text-white"
        >
          <span className="flex items-center gap-2">
            <BitrateIcon />
            Bitrate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-[#D97757]/10 px-1.5 py-1 text-[#D97757]">
              <Sparkles className="size-3" />
              {value}
            </span>
            <ChevronDown className="size-3.5 text-zinc-500" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100000] w-[326px] rounded-xl border border-white/[0.07] bg-[#1d2022]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <div role="listbox" aria-label="Bitrate" className="space-y-0.5">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <Popover.Close asChild key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => onChange(option.value)}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-white/[0.04] ${
                      option.value === value ? "bg-white/[0.05]" : ""
                    }`}
                  >
                    <Icon className="size-4 shrink-0 text-zinc-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-white">
                        {option.value}
                      </span>
                      <span className="block text-[10px] text-zinc-500">
                        {option.description}
                      </span>
                    </span>
                    {option.value === value && (
                      <Check className="size-4 text-[#D97757]" />
                    )}
                  </button>
                </Popover.Close>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type ExtendDirection = "Sequel" | "Prequel";

function SeedanceDirectionControl({
  value,
  onChange,
}: {
  value: ExtendDirection;
  onChange: (value: ExtendDirection) => void;
}) {
  const options = [
    {
      value: "Sequel" as const,
      description: "Continue after the end",
      icon: ArrowRight,
    },
    {
      value: "Prequel" as const,
      description: "Build before the start",
      icon: ArrowLeft,
    },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md bg-white/[0.05] px-3 text-xs font-semibold text-white"
        >
          <span className="flex items-center gap-2">
            <Film className="size-4 shrink-0 text-zinc-300" />
            Direction
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-[#D97757]/10 px-1.5 py-1 text-[#D97757]">
              {value}
            </span>
            <ChevronDown className="size-3.5 text-zinc-500" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100000] w-[326px] rounded-xl border border-white/[0.07] bg-[#1d2022]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <div role="listbox" aria-label="Direction" className="space-y-0.5">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <Popover.Close asChild key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => onChange(option.value)}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-white/[0.04] ${
                      option.value === value ? "bg-white/[0.05]" : ""
                    }`}
                  >
                    <Icon className="size-4 shrink-0 text-zinc-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-white">
                        {option.value}
                      </span>
                      <span className="block text-[10px] text-zinc-500">
                        {option.description}
                      </span>
                    </span>
                    {option.value === value && (
                      <Check className="size-4 text-[#D97757]" />
                    )}
                  </button>
                </Popover.Close>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CinefieldAdvancedSettings({
  capabilities,
  duration,
  onDurationChange,
  seed,
  onSeedChange,
  seedLocked,
  onSeedLockedChange,
  steps,
  onStepsChange,
}: {
  capabilities: CinefieldCapabilities;
  duration: string;
  onDurationChange: (value: string) => void;
  seed: string;
  onSeedChange: (value: string) => void;
  seedLocked: boolean;
  onSeedLockedChange: (value: boolean) => void;
  steps: number;
  onStepsChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const stepsRange = capabilities.steps;
  const stepsProgress =
    stepsRange.max > stepsRange.min
      ? ((steps - stepsRange.min) / (stepsRange.max - stepsRange.min)) * 100
      : 100;
  const SeedLockIcon = seedLocked ? Lock : LockOpen;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Open advanced settings"
          aria-expanded={open}
          className={`flex w-[52px] shrink-0 items-center justify-center self-stretch rounded-xl border transition-all duration-200 ease-out ${
            open
              ? "border-[#D97757] bg-white/[0.06] text-[#D97757] shadow-[0_0_12px_rgba(217,119,87,0.30)]"
              : "border-white/[0.07] bg-white/[0.035] text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]"
          }`}
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
          className="z-[100000] w-[480px] max-w-[calc(100vw-24px)] rounded-2xl border border-white/10 bg-[#1d2022]/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <p className="text-sm font-semibold text-white">Advanced</p>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-zinc-300">
                Duration
              </span>
              <div
                role="radiogroup"
                aria-label="Duration"
                className="flex rounded-lg bg-[#131517] p-1"
              >
                {capabilities.durationOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={duration === option}
                    onClick={() => onDurationChange(option)}
                    className={`h-7 rounded-md px-3 text-xs font-semibold transition-colors ${
                      duration === option
                        ? "bg-white/10 text-white"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-zinc-300">Seed</span>
              <div className="flex h-9 w-[220px] items-center overflow-hidden rounded-md border border-[#424242] bg-[#202326]">
                <input
                  type="text"
                  name="standalone-cinefield-seed"
                  value={seed}
                  onChange={(event) => onSeedChange(event.target.value)}
                  aria-label="Seed"
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-xs font-semibold text-white outline-none placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  aria-label={seedLocked ? "Unlock seed" : "Lock seed"}
                  aria-pressed={seedLocked}
                  onClick={() => onSeedLockedChange(!seedLocked)}
                  className={`flex h-full w-9 shrink-0 items-center justify-center border-l border-[#424242] transition-colors ${
                    seedLocked
                      ? "text-[#D97757]"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <SeedLockIcon className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-zinc-300">Steps</span>
              <div
                className="relative flex h-9 w-[220px] items-center overflow-hidden rounded-md border border-[#424242] bg-[#202326] px-3 focus-within:ring-1 focus-within:ring-white/40"
                style={
                  {
                    "--steps-progress": `${stepsProgress}%`,
                  } as React.CSSProperties
                }
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 bg-white/[0.045]"
                  style={{ width: "var(--steps-progress)" }}
                />
                <span className="absolute left-3 text-xs font-semibold text-white">
                  {steps}
                </span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-white"
                  style={{ left: "var(--steps-progress)" }}
                />
                <input
                  type="range"
                  name="standalone-cinefield-steps"
                  min={stepsRange.min}
                  max={stepsRange.max}
                  step={1}
                  value={steps}
                  onChange={(event) => onStepsChange(Number(event.target.value))}
                  aria-label="Steps"
                  aria-valuemin={stepsRange.min}
                  aria-valuemax={stepsRange.max}
                  aria-valuenow={steps}
                  className="absolute inset-0 size-full cursor-ew-resize opacity-0 active:cursor-grabbing"
                />
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type MotionControlQuality = "720p" | "1080p";

type MotionControlState = {
  motionVideoName: string;
  characterImageName: string;
  quality: MotionControlQuality;
  sceneControlEnabled: boolean;
  sceneSource: "video" | "image";
  advancedOpen: boolean;
  prompt: string;
  orientation: "video" | "image";
};

const SHARED_KLING_MOTION_CAPABILITIES = {
  motionVideoAccept: "video/mp4,video/quicktime",
  characterImageAccept: "image/jpeg,image/jpg,image/png",
  qualityOptions: [
    {
      value: "720p" as const,
      description: "Balanced quality • 1.5 credits/sec",
    },
    {
      value: "1080p" as const,
      description: "Higher quality • 2.5 credits/sec",
    },
  ],
} as const;

function createMotionControlState(): MotionControlState {
  return {
    motionVideoName: "",
    characterImageName: "",
    quality: "720p",
    // Reference: Scene control mode defaults ON with the Image sub-tab
    // selected; Orientation defaults to Video.
    sceneControlEnabled: true,
    sceneSource: "image",
    advancedOpen: false,
    prompt: "",
    orientation: "video",
  };
}

// Reference credits: Kling 3.0 Motion Control @720p shows 7 with Scene
// control ON and 5 with it OFF; the older Kling Motion Control shows 5.
// The Quality listbox prices 720p at 1.5 credits/sec and 1080p at 2.5
// credits/sec, so 1080p scales the recorded 720p figure by 2.5/1.5.
function getMotionControlCredits(
  modelId: string,
  state: MotionControlState,
): number {
  const base =
    modelId === "kling-3.0-motion-control" && state.sceneControlEnabled
      ? 7
      : 5;
  return state.quality === "1080p"
    ? Math.round(base * (2.5 / 1.5) * 10) / 10
    : base;
}

function MotionControlUploadCard({
  title,
  description,
  icon: Icon,
  accept,
  fileName,
  onFileNameChange,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  accept: string;
  fileName: string;
  onFileNameChange: (name: string) => void;
}) {
  return (
    <label className="flex aspect-[3/4] min-w-0 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-2 text-center transition-colors hover:border-[#D97757]/55 hover:bg-[#D97757]/[0.04]">
      <input
        type="file"
        className="sr-only"
        accept={accept}
        aria-label={title}
        onChange={(event) =>
          onFileNameChange(event.target.files?.[0]?.name ?? "")
        }
      />
      <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-zinc-300 shadow-[inset_0_0_4px_rgba(185,185,185,0.28)] @min-[320px]:size-12">
        {fileName ? (
          <Check className="size-4 text-[#D97757] @min-[320px]:size-5" />
        ) : (
          <Icon className="size-4 @min-[320px]:size-5" />
        )}
      </span>
      <span className="mt-3 text-xs font-semibold text-white">
        {fileName || title}
      </span>
      <span className="mt-1 whitespace-pre-line text-[11px] leading-4 text-zinc-500">
        {fileName ? "Ready to use" : description}
      </span>
    </label>
  );
}

function MotionQualityControl({
  value,
  onChange,
}: {
  value: MotionControlQuality;
  onChange: (value: MotionControlQuality) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Quality: ${value}`}
          className="flex h-12 w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 text-left hover:bg-white/[0.06]"
        >
          <span>
            <span className="block text-[10px] text-zinc-500">Quality</span>
            <span className="text-sm font-semibold text-white">{value}</span>
          </span>
          <ChevronDown className="size-4 -rotate-90 text-zinc-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          role="listbox"
          aria-label="Quality"
          className="z-[100000] w-[270px] rounded-xl border border-white/10 bg-[#1d2022]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          {SHARED_KLING_MOTION_CAPABILITIES.qualityOptions.map((option) => (
            <Popover.Close asChild key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => onChange(option.value)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                  option.value === value
                    ? "bg-white/[0.07]"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <span>
                  <span className="block text-xs font-semibold text-white">
                    {option.value}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {option.description}
                  </span>
                </span>
                {option.value === value && (
                  <Check className="size-4 text-zinc-300" />
                )}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function KlingMotionControlForm({
  model,
  state,
  onChange,
  onHowItWorks,
  onOpenModelPanel,
  modelOpen,
}: {
  model: WorkflowModel;
  state: MotionControlState;
  onChange: (patch: Partial<MotionControlState>) => void;
  onHowItWorks: () => void;
  onOpenModelPanel: () => void;
  modelOpen?: boolean;
}) {
  const advancedId = `motion-advanced-${model.id}`;
  const advancedTriggerId = `${advancedId}-trigger`;

  return (
    <>
      <figure className="relative aspect-[2.3] w-full select-none overflow-hidden rounded-xl group mb-1">
        <video
          loop
          playsInline
          disablePictureInPicture
          preload="none"
          src="https://static.higgsfield.ai/v2-fnf-web-kmc-preset.mp4"
          className="size-full w-full h-full rounded-md object-cover"
          onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
          onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
        >
          Your browser does not support the video.
        </video>
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%)",
          }}
        />
        <button
          type="button"
          onClick={onHowItWorks}
          className="absolute left-3 top-3 z-10 inline-flex h-6 items-center gap-1 rounded-lg border border-white/10 bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-black"
        >
          <BookOpen className="size-3.5" />
          {/* The older Kling Motion Control relabels the same control. */}
          {model.id === "kling-motion-control"
            ? "Open Motion Library"
            : "How it works"}
        </button>
        <figcaption className="absolute bottom-3 left-3 right-3 z-10 min-w-0">
          <p className="w-full truncate text-base font-black uppercase text-[#D97757]">
            MOTION CONTROL
          </p>
          <p className="truncate text-xs text-white/60">
            Control motion with video references
          </p>
        </figcaption>
      </figure>

      <div className="grid w-full grid-cols-2 gap-1 rounded-[20px] border border-white/[0.07] p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <MotionControlUploadCard
          title="Add motion to copy"
          description={"Video duration:\n3–30 seconds"}
          icon={Video}
          accept={SHARED_KLING_MOTION_CAPABILITIES.motionVideoAccept}
          fileName={state.motionVideoName}
          onFileNameChange={(motionVideoName) => onChange({ motionVideoName })}
        />
        <MotionControlUploadCard
          title="Add your character"
          description={"Image with visible\nface and body"}
          icon={Plus}
          accept={SHARED_KLING_MOTION_CAPABILITIES.characterImageAccept}
          fileName={state.characterImageName}
          onFileNameChange={(characterImageName) =>
            onChange({ characterImageName })
          }
        />
      </div>

      <ModelTrigger model={model} open={modelOpen} onClick={onOpenModelPanel} />

      <MotionQualityControl
        value={state.quality}
        onChange={(quality) => onChange({ quality })}
      />

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">
            Scene control mode
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={state.sceneControlEnabled}
            aria-label="Scene control mode"
            onClick={() =>
              onChange({ sceneControlEnabled: !state.sceneControlEnabled })
            }
            className={`flex h-6 w-9 items-center rounded-full p-0.5 transition-colors ${
              state.sceneControlEnabled ? "bg-emerald-500" : "bg-zinc-700"
            }`}
          >
            <span
              className={`size-5 rounded-full bg-white transition-transform ${
                state.sceneControlEnabled ? "translate-x-3" : ""
              }`}
            />
          </button>
        </div>

        <div
          aria-hidden={!state.sceneControlEnabled}
          inert={!state.sceneControlEnabled ? true : undefined}
          className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ${
            state.sceneControlEnabled
              ? "mt-3 grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              role="radiogroup"
              aria-label="Scene source"
              className="grid grid-cols-2 rounded-xl border border-white/[0.07] bg-black/20 p-1"
            >
              {(["video", "image"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={state.sceneSource === value}
                  onClick={() => onChange({ sceneSource: value })}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold capitalize ${
                    state.sceneSource === value
                      ? "bg-white/10 text-white"
                      : "text-zinc-500"
                  }`}
                >
                  {value === "video" ? (
                    <Video className="size-3.5" />
                  ) : (
                    <ImageIcon className="size-3.5" />
                  )}
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">
              Choose where the background should come from: the character image
              or the motion video
            </p>
          </div>
        </div>
      </div>

      {/* Reference: h3 > button trigger, inline accordion (role=region).
          Contents are EXACTLY Prompt + Orientation + helper — no uploads,
          seed, steps, or pill row. Fully independent from Scene control. */}
      <h3>
        <button
          type="button"
          id={advancedTriggerId}
          aria-expanded={state.advancedOpen}
          aria-controls={advancedId}
          onClick={() => onChange({ advancedOpen: !state.advancedOpen })}
          className="flex w-full items-center justify-between py-2 text-xs font-semibold text-white"
        >
          Advanced settings
          <ChevronDown
            className={`size-4 transition-transform ${
              state.advancedOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      <div
        id={advancedId}
        role="region"
        aria-labelledby={advancedTriggerId}
        aria-hidden={!state.advancedOpen}
        inert={!state.advancedOpen ? true : undefined}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ${
          state.advancedOpen
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 pb-1">
            <label className="block rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
              <span className="text-xs font-semibold text-zinc-300">
                Prompt
              </span>
              <textarea
                rows={5}
                maxLength={2500}
                value={state.prompt}
                onChange={(event) => onChange({ prompt: event.target.value })}
                placeholder={'Describe background and scene details – e.g., "A corgi runs in" or "Snowy park setting". Motion is controlled by your reference video'}
                className="mt-1 min-h-[100px] max-h-64 w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
              />
            </label>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-400">Orientation</p>
              <div
                role="radiogroup"
                aria-label="Orientation"
                className="relative flex rounded-xl border border-white/[0.07] bg-white/[0.035] p-1"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white/10 transition-transform duration-200 ${
                    state.orientation === "image" ? "translate-x-full" : ""
                  }`}
                />
                {(["video", "image"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={state.orientation === value}
                    onClick={() => onChange({ orientation: value })}
                    className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold capitalize transition-colors ${
                      state.orientation === value
                        ? "text-white"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {value === "video" ? (
                      <Video className="size-3.5" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                    {value}
                  </button>
                ))}
              </div>
              <p className="px-1 text-[11px] leading-4 text-zinc-500">
                When Character Orientation matches the video, complex motions perform better; when it matches the image, camera movements are better supported.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

interface StandaloneVideoCreationPanelProps {
  workflow: StandaloneVideoWorkflow;
  onWorkflowChange: (workflow: StandaloneVideoWorkflow) => void;
  /**
   * Mix/Change on the preset figure. "change" picks a new preset, "mix"
   * blends a second preset into the current one. A later stage wires this
   * to the right-column preset selector; the default is a no-op.
   */
  onOpenPresetSelector?: (mode: "change" | "mix") => void;
  /**
   * The preset the preview card shows, owned by the page so the right-column
   * preset selector can change it. A "mix" selection reads "<preset> x
   * <second motion>". Defaults to the reference's "General".
   */
  presetName?: string;
  /**
   * "How it works" / "Open Motion Library" on the Motion Control preview
   * card. The reference swaps the RIGHT COLUMN content for the 3-step
   * tutorial (no modal); pressing it again restores the motion-library
   * view. The page owns that state; the default is a no-op.
   */
  onToggleMotionTutorial?: () => void;
}

type CreatePickerTarget =
  | "seedance-references"
  | "seedance25-references"
  | "seedance25-extend-video"
  | "seedance25-extend-references"
  | "h3-references"
  | "h3-start-frame"
  | "h3-end-frame"
  | "flux-frames"
  | "flux-video"
  // Edit Video tab cards — the reference's edit_video / edit_references
  // assets-picker call types.
  | "edit-video"
  | "edit-references";

const CREATE_PICKER_ACCEPT: Record<CreatePickerTarget, string> = {
  "seedance-references": "image/*,video/*,audio/*",
  "seedance25-references": "image/*,video/*,audio/*",
  "seedance25-extend-video": "video/*",
  "seedance25-extend-references": "image/*,audio/*",
  "h3-references": "image/*,video/*,audio/*",
  "h3-start-frame": "image/*",
  "h3-end-frame": "image/*",
  "flux-frames": "image/*",
  "flux-video": "video/*",
  "edit-video": "video/*",
  "edit-references": "image/*,audio/*",
};

export default function StandaloneVideoCreationPanel({
  workflow,
  onWorkflowChange,
  onOpenPresetSelector = () => {},
  presetName = "General",
  onToggleMotionTutorial = () => {},
}: StandaloneVideoCreationPanelProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [modelIndexes, setModelIndexes] = useState(DEFAULT_MODEL_INDEX);
  const [modelOpen, setModelOpen] = useState(false);
  const [handledModelParam, setHandledModelParam] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5s");
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [omniEditVideoName, setOmniEditVideoName] = useState("");
  const [omniEditSupportingName, setOmniEditSupportingName] = useState("");
  // Edit Video tab (Seedance 2.5 Edit layout)
  const [editMethod, setEditMethod] = useState<"prompt" | "draw">("prompt");
  const [editVideoAssetName, setEditVideoAssetName] = useState("");
  const [editReferencesAssetName, setEditReferencesAssetName] = useState("");
  const [editEnhance, setEditEnhance] = useState(true);
  const [editResolution, setEditResolution] = useState("1080p");
  const [editBitrate, setEditBitrate] = useState<"High" | "Standard">("High");
  // Cinefield Reframe variant
  const [reframeVideoName, setReframeVideoName] = useState("");
  const [reframeRatio, setReframeRatio] = useState("16:9");
  const [reframeQuality, setReframeQuality] = useState("720p");
  const [generating, setGenerating] = useState(false);
  const [seedanceMediaName, setSeedanceMediaName] = useState("");
  const [seedanceAudioEnabled, setSeedanceAudioEnabled] = useState(true);
  const [seedanceDuration, setSeedanceDuration] = useState(10);
  const [seedanceAspectRatio, setSeedanceAspectRatio] = useState("Auto");
  const [seedanceResolution, setSeedanceResolution] = useState("720p");
  const [seedanceBitrate, setSeedanceBitrate] = useState<
    "High" | "Standard"
  >("High");
  const [happyHorseImageName, setHappyHorseImageName] = useState("");
  const [happyHorseDuration, setHappyHorseDuration] = useState(7);
  const [happyHorseAspectRatio, setHappyHorseAspectRatio] = useState("16:9");
  const [happyHorseResolution, setHappyHorseResolution] = useState("720p");
  const [grokImageName, setGrokImageName] = useState("");
  const [grokDurationStr, setGrokDurationStr] = useState("15s");
  const [grokDurationNum, setGrokDurationNum] = useState(5);
  const [grokAspectRatio, setGrokAspectRatio] = useState("Auto");
  const [grokResolution, setGrokResolution] = useState("720p");
  const [klingImageName, setKlingImageName] = useState("");
  const [klingDurationNum, setKlingDurationNum] = useState(8);
  const [klingAspectRatio, setKlingAspectRatio] = useState("16:9");
  const [klingResolution, setKlingResolution] = useState("1080p");
  // Kling 3.0 specific states (isolated from Turbo)
  const [kling3StartFrame, setKling3StartFrame] = useState("");
  const [kling3EndFrame, setKling3EndFrame] = useState("");
  const [kling3MultiShot, setKling3MultiShot] = useState(false);
  const [kling3MultiShotMode, setKling3MultiShotMode] = useState("Auto");
  const [kling3Resolution, setKling3Resolution] = useState("4K");
  const [kling3DurationNum, setKling3DurationNum] = useState(
    KLING_MODEL_CAPABILITIES["Kling 3.0"].durationSlider.default,
  );
  const [kling3Shots, setKling3Shots] = useState<
    { prompt: string; duration: number }[]
  >([{ prompt: "", duration: 3 }]);
  const [kling3ElementsOpen, setKling3ElementsOpen] = useState(false);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [, setElementReferences] = useState<string[]>([]);
  const [geminiInputMode, setGeminiInputMode] = useState<
    "elements" | "frames"
  >("elements");
  const [geminiElementsMedia, setGeminiElementsMedia] = useState("");
  const [geminiStartFrame, setGeminiStartFrame] = useState("");
  const [geminiEndFrame, setGeminiEndFrame] = useState("");
  const [geminiDuration, setGeminiDuration] = useState(8);
  const [geminiAspectRatio, setGeminiAspectRatio] = useState("16:9");
  const [geminiPickerTarget, setGeminiPickerTarget] = useState<
    "elements" | "startFrame" | "endFrame" | null
  >(null);
  const [createPickerTarget, setCreatePickerTarget] =
    useState<CreatePickerTarget | null>(null);
  // Cinefield family (Cinefield Standard layout)
  const [cinefieldImageName, setCinefieldImageName] = useState("");
  const [cinefieldEnhance, setCinefieldEnhance] = useState(true);
  const [cinefieldDuration, setCinefieldDuration] = useState("5s");
  const [cinefieldSeed, setCinefieldSeed] = useState("Random");
  const [cinefieldSeedLocked, setCinefieldSeedLocked] = useState(false);
  const [cinefieldSteps, setCinefieldSteps] = useState(20);
  // MiniMax H3
  const [h3Mode, setH3Mode] = useState<"references" | "frames">("references");
  const [h3ReferenceMedia, setH3ReferenceMedia] = useState("");
  const [h3StartFrame, setH3StartFrame] = useState("");
  const [h3EndFrame, setH3EndFrame] = useState("");
  const [h3Duration, setH3Duration] = useState(5);
  const [h3AspectRatio, setH3AspectRatio] = useState("Auto");
  // Seedance 2.5
  const [seedance25Mode, setSeedance25Mode] = useState<
    "references" | "extend"
  >("references");
  const [seedance25ReferenceMedia, setSeedance25ReferenceMedia] = useState("");
  const [seedance25ExtendVideo, setSeedance25ExtendVideo] = useState("");
  const [seedance25ExtendReferences, setSeedance25ExtendReferences] =
    useState("");
  const [seedance25Duration, setSeedance25Duration] = useState(5);
  const [seedance25AspectRatio, setSeedance25AspectRatio] = useState("16:9");
  const [seedance25Resolution, setSeedance25Resolution] = useState("1080p");
  const [seedance25Bitrate, setSeedance25Bitrate] = useState<
    "High" | "Standard"
  >("High");
  const [seedance25Direction, setSeedance25Direction] =
    useState<ExtendDirection>("Sequel");
  const [seedance25Enhance, setSeedance25Enhance] = useState(true);
  // FLUX.3 Video
  const [fluxMode, setFluxMode] = useState<"frames" | "video">("frames");
  const [fluxFrameRefs, setFluxFrameRefs] = useState("");
  const [fluxVideoRef, setFluxVideoRef] = useState("");
  const [fluxAudio, setFluxAudio] = useState(true);
  const [fluxDuration, setFluxDuration] = useState(5);
  const [fluxAspectRatio, setFluxAspectRatio] = useState("Auto");
  const [fluxResolution, setFluxResolution] = useState("720p");
  // Sora 2
  const [soraImageName, setSoraImageName] = useState("");
  const [soraDuration, setSoraDuration] = useState(12);
  const [soraAspectRatio, setSoraAspectRatio] = useState("16:9");
  const [motionStates, setMotionStates] = useState<
    Record<string, MotionControlState>
  >(() =>
    Object.fromEntries(
      MOTION_CONTROL_MODELS.map((model) => [
        model.id,
        createMotionControlState(),
      ]),
    ),
  );
  const models = WORKFLOW_MODELS[workflow];
  const selectedIndex = modelIndexes[workflow];
  const selectedModel = models[selectedIndex];
  const seedanceCapabilities =
    workflow === "create-video"
      ? SEEDANCE_MODEL_CAPABILITIES[selectedModel.name]
      : undefined;
  const geminiCapabilities =
    workflow === "create-video"
      ? GEMINI_OMNI_FLASH_CAPABILITIES[selectedModel.name]
      : undefined;
  const happyHorseCapabilities =
    workflow === "create-video"
      ? HAPPYHORSE_MODEL_CAPABILITIES[selectedModel.name]
      : undefined;
  const grokCapabilities =
    workflow === "create-video"
      ? GROK_MODEL_CAPABILITIES[selectedModel.name]
      : undefined;
  const klingCapabilities =
    workflow === "create-video"
      ? KLING_MODEL_CAPABILITIES[selectedModel.name]
      : undefined;
  const cinefieldCapabilities =
    workflow === "create-video"
      ? CINEFIELD_MODEL_CAPABILITIES[selectedModel.name]
      : undefined;
  const minimaxH3Capabilities =
    workflow === "create-video"
      ? MINIMAX_H3_CAPABILITIES[selectedModel.name]
      : undefined;
  const seedance25Capabilities =
    workflow === "create-video"
      ? SEEDANCE_25_CAPABILITIES[selectedModel.name]
      : undefined;
  const flux3Capabilities =
    workflow === "create-video"
      ? FLUX3_VIDEO_CAPABILITIES[selectedModel.name]
      : undefined;
  const sora2Capabilities =
    workflow === "create-video"
      ? SORA2_CAPABILITIES[selectedModel.name]
      : undefined;
  // Kling 3.0 Multi-shot Custom: per-shot blocks replace the global prompt
  // and the global Duration pill; credits become 18 per shot.
  const kling3CustomShotsActive =
    Boolean(klingCapabilities?.multiShot) &&
    kling3MultiShot &&
    kling3MultiShotMode === "Custom";
  const motionState =
    workflow === "motion-control"
      ? motionStates[selectedModel.id] ?? createMotionControlState()
      : null;
  // Edit Video tab variants: Cinefield Reframe swaps the whole panel; the
  // Kling 3.0 Omni Edit rows keep their own per-model asset selections.
  const isReframe =
    workflow === "edit-video" && selectedModel.id === "higgsfield-reframe";
  const isOmniEdit =
    workflow === "edit-video" && selectedModel.panel === "omni-edit";
  const editVideoSelected = isOmniEdit
    ? Boolean(omniEditVideoName)
    : Boolean(editVideoAssetName);
  const editReferencesSelected = isOmniEdit
    ? Boolean(omniEditSupportingName)
    : Boolean(editReferencesAssetName);

  const openModelPanel = () => {
    setModelOpen(true);
  };

  // Navbar deep-link: ?model=<name> selects a model (and its tab). Own state
  // is adjusted during render (React's derived-state pattern); the parent is
  // notified from an effect, once per param change.
  const requestedModelParam = searchParams.get("model");
  const requestedModelTarget = (() => {
    if (!requestedModelParam) return null;
    const target = NAVBAR_MODEL_TARGETS[requestedModelParam];
    if (!target) return null;
    const targetModels = WORKFLOW_MODELS[target.workflow];
    const targetIndex = targetModels.findIndex(
      (model) => model.name === target.modelName,
    );
    if (targetIndex < 0) return null;
    if (
      targetModels[targetIndex].disabled ||
      targetModels[targetIndex].available === false
    )
      return null;
    return { workflow: target.workflow, index: targetIndex };
  })();

  if (handledModelParam !== requestedModelParam) {
    setHandledModelParam(requestedModelParam);
    if (requestedModelTarget) {
      setModelIndexes((current) => ({
        ...current,
        [requestedModelTarget.workflow]: requestedModelTarget.index,
      }));
      setModelOpen(false);
    }
  }

  const requestedWorkflow = requestedModelTarget?.workflow ?? null;
  // Announce each requested tab exactly ONCE. The parent re-creates its
  // onWorkflowChange callback every render, so an unguarded effect would
  // re-run on every parent render and pin the tab to the deep link — tab
  // clicks and cross-tab model jumps would snap straight back.
  const announcedWorkflowRef = useRef<StandaloneVideoWorkflow | null>(null);
  useEffect(() => {
    if (!requestedWorkflow) return;
    if (announcedWorkflowRef.current === requestedWorkflow) return;
    announcedWorkflowRef.current = requestedWorkflow;
    onWorkflowChange(requestedWorkflow);
  }, [onWorkflowChange, requestedWorkflow]);

  // Restore the last selected model (and its tab) from localStorage in the
  // first post-hydration render — the same derive-during-render pattern as
  // the ?model= deep link above, since reading storage during the hydration
  // render would mismatch the server-rendered defaults, and setState in an
  // effect is linted against. A ?model= deep link takes precedence.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const [storageRestored, setStorageRestored] = useState(false);
  const [restoredWorkflow, setRestoredWorkflow] =
    useState<StandaloneVideoWorkflow | null>(null);

  if (hydrated && !storageRestored) {
    setStorageRestored(true);
    if (!requestedModelParam) {
      try {
        const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
        const saved = raw
          ? (JSON.parse(raw) as { workflow?: string; modelId?: string })
          : null;
        const savedWorkflow = WORKFLOWS.find(
          (item) => item.value === saved?.workflow,
        )?.value;
        const savedIndex = savedWorkflow
          ? WORKFLOW_MODELS[savedWorkflow].findIndex(
              (model) => model.id === saved?.modelId,
            )
          : -1;
        const savedModel =
          savedWorkflow && savedIndex >= 0
            ? WORKFLOW_MODELS[savedWorkflow][savedIndex]
            : null;
        if (
          savedWorkflow &&
          savedModel &&
          !savedModel.disabled &&
          savedModel.available !== false
        ) {
          setModelIndexes((current) => ({
            ...current,
            [savedWorkflow]: savedIndex,
          }));
          setRestoredWorkflow(savedWorkflow);
        }
      } catch {
        // Corrupted or unavailable storage is ignored; the defaults stand.
      }
    }
  }

  // The parent owns the workflow, so it is notified from an effect (same
  // pattern as the ?model= deep link's onWorkflowChange call above) — and,
  // for the same reason, only once: a restored tab must not out-argue the
  // tab the user picks afterwards.
  const restoreAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!restoredWorkflow || restoreAnnouncedRef.current) return;
    restoreAnnouncedRef.current = true;
    onWorkflowChange(restoredWorkflow);
  }, [onWorkflowChange, restoredWorkflow]);

  // Persist every selection change. Gated on storageRestored so the first
  // effect flush (which runs before the post-hydration restore render)
  // cannot clobber the saved value with the defaults.
  const selectedModelIdForStorage =
    WORKFLOW_MODELS[workflow][modelIndexes[workflow]]?.id;
  useEffect(() => {
    if (!storageRestored || !selectedModelIdForStorage) return;
    try {
      window.localStorage.setItem(
        MODEL_STORAGE_KEY,
        JSON.stringify({ workflow, modelId: selectedModelIdForStorage }),
      );
    } catch {
      // Storage may be unavailable (private mode / quota); ignore.
    }
  }, [storageRestored, workflow, selectedModelIdForStorage]);

  const changeWorkflow = (nextWorkflow: StandaloneVideoWorkflow) => {
    onWorkflowChange(nextWorkflow);
    // Reference: clicking a tab auto-selects that mode's default model
    // (Edit Video → Seedance 2.5 Edit, Motion Control → Kling 3.0 Motion
    // Control). Create Video keeps its last selection.
    if (nextWorkflow !== "create-video") {
      setModelIndexes((current) => ({
        ...current,
        [nextWorkflow]: DEFAULT_MODEL_INDEX[nextWorkflow],
      }));
    }
    setModelOpen(false);
  };

  const selectModel = (
    targetWorkflow: StandaloneVideoWorkflow,
    index: number,
  ) => {
    const nextModel = WORKFLOW_MODELS[targetWorkflow][index];
    if (!nextModel || nextModel.disabled || nextModel.available === false)
      return;
    if (targetWorkflow !== workflow) {
      onWorkflowChange(targetWorkflow);
    }
    setModelIndexes((current) => ({ ...current, [targetWorkflow]: index }));
    setModelOpen(false);
  };

  const updateMotionState = (
    modelId: string,
    patch: Partial<MotionControlState>,
  ) => {
    setMotionStates((current) => ({
      ...current,
      [modelId]: {
        ...(current[modelId] ?? createMotionControlState()),
        ...patch,
      },
    }));
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    await new Promise((resolve) => setTimeout(resolve, 1400));
    setGenerating(false);
  };

  return (
    // Reference geometry: the left panel is a fixed 20rem (320px) column
    // (md:grid-cols-[20rem_1fr]); the form is content-height and only splits
    // into a hidden-scrollbar scroll region + fixed Generate footer once it
    // hits its max-height (Create/Motion: calc(100vh-3rem); Edit:
    // md:max-h-[calc(100vh-10rem)]).
    <div className="relative z-20 w-full shrink-0 lg:w-80 lg:self-start">
      <aside
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#17191b] ${
          workflow === "edit-video"
            ? "md:max-h-[calc(100vh-10rem)]"
            : "max-h-[calc(100vh-3rem)]"
        }`}
      >
        <div
          role="tablist"
          aria-label="Video workflow"
          className="flex shrink-0 gap-3 overflow-x-auto border-b border-white/[0.07] px-4 pt-3 [scrollbar-width:none]"
        >
          {WORKFLOWS.map((item) => {
            const selected = workflow === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => changeWorkflow(item.value)}
                className={`h-9 shrink-0 whitespace-nowrap border-b-2 text-[16px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500 ${
                  selected ? "text-white" : "text-zinc-500 hover:text-zinc-200"
                } ${selected ? "border-b-white" : "border-b-transparent"}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {/* Reference: the Motion Control tab's only banner is the form's
              own preview figure — no extra WorkflowBanner above it. */}
          {workflow === "create-video" &&
            (seedanceCapabilities || seedance25Capabilities ? (
              <SeedanceBanner
                modelName={selectedModel.name}
                presetName={presetName}
                onChangeClick={() => onOpenPresetSelector("change")}
              />
            ) : geminiCapabilities ||
              happyHorseCapabilities ||
              grokCapabilities ||
              klingCapabilities ||
              cinefieldCapabilities ||
              minimaxH3Capabilities ||
              flux3Capabilities ||
              sora2Capabilities ? null : (
              <WorkflowBanner workflow={workflow} model={selectedModel} />
            ))}

          {workflow === "create-video" && (
            <>
              {cinefieldCapabilities ? (
                <>
                  <PresetFigure
                    subtitle={cinefieldCapabilities.presetName}
                    presetName={presetName}
                    showMix
                    clickable
                    onOpenPresetSelector={onOpenPresetSelector}
                  />
                  <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <label className="flex h-[130px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]">
                      <input
                        type="file"
                        id="standalone-cinefield-imageUrl"
                        name="standalone-cinefield-imageUrl"
                        className="sr-only"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(event) =>
                          setCinefieldImageName(
                            event.target.files?.[0]?.name ?? "",
                          )
                        }
                      />
                      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                        {cinefieldImageName ? (
                          <Check className="size-4 text-[#D97757]" />
                        ) : (
                          <ImageIcon className="size-4 text-zinc-300" />
                        )}
                      </span>
                      <span className="mt-2 text-xs font-medium text-zinc-300">
                        {cinefieldImageName || (
                          <>
                            Upload image or{" "}
                            <GenerateItSpan
                              onGenerateIt={() => router.push("/image")}
                            />
                          </>
                        )}
                      </span>
                      <span className="mt-1 text-[11px] font-medium text-zinc-500">
                        {cinefieldImageName
                          ? "Ready to use"
                          : "PNG, JPG or Paste from clipboard"}
                      </span>
                    </label>
                  </div>
                  <div className="relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]">
                    <label
                      htmlFor="standalone-cinefield-prompt"
                      className="absolute left-3 top-3 text-xs font-medium text-zinc-500"
                    >
                      Prompt
                    </label>
                    <textarea
                      id="standalone-cinefield-prompt"
                      name="standalone-cinefield-prompt"
                      rows={4}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the scene you imagine, with details."
                      className="mt-8 min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <label className="flex h-12 w-full cursor-pointer items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 text-sm font-semibold text-white">
                    <span>Enhance {cinefieldEnhance ? "on" : "off"}</span>
                    <input
                      type="checkbox"
                      name="enhancePrompt"
                      className="sr-only"
                      checked={cinefieldEnhance}
                      onChange={(event) =>
                        setCinefieldEnhance(event.target.checked)
                      }
                    />
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${
                        cinefieldEnhance ? "bg-[#D97757]" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`size-5 rounded-full bg-white transition-transform ${
                          cinefieldEnhance ? "translate-x-4" : ""
                        }`}
                      />
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <ModelTrigger
                        model={selectedModel}
                        open={modelOpen}
                        onClick={openModelPanel}
                      />
                    </div>
                    <CinefieldAdvancedSettings
                      capabilities={cinefieldCapabilities}
                      duration={cinefieldDuration}
                      onDurationChange={setCinefieldDuration}
                      seed={cinefieldSeed}
                      onSeedChange={setCinefieldSeed}
                      seedLocked={cinefieldSeedLocked}
                      onSeedLockedChange={setCinefieldSeedLocked}
                      steps={cinefieldSteps}
                      onStepsChange={setCinefieldSteps}
                    />
                  </div>
                </>
              ) : minimaxH3Capabilities ? (
                <>
                  <PresetFigure
                    subtitle={selectedModel.name}
                    presetName={presetName}
                    onOpenPresetSelector={onOpenPresetSelector}
                  />
                  <SegmentModeSwitch
                    value={h3Mode}
                    onChange={setH3Mode}
                    ariaLabel="MiniMax H3 input mode"
                    options={[
                      { value: "references", label: "References" },
                      { value: "frames", label: "Frames" },
                    ]}
                  />
                  {h3Mode === "references" ? (
                    <SeedanceMediaUpload
                      selected={Boolean(h3ReferenceMedia)}
                      onClick={() => setCreatePickerTarget("h3-references")}
                      helper="Up to 9 images and elements, 3 videos, and 3 audio files"
                    />
                  ) : (
                    <GeminiFramesInput
                      startSelected={Boolean(h3StartFrame)}
                      endSelected={Boolean(h3EndFrame)}
                      onStartClick={() =>
                        setCreatePickerTarget("h3-start-frame")
                      }
                      onEndClick={() => setCreatePickerTarget("h3-end-frame")}
                    />
                  )}
                  <SeedancePromptCard
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    showElements={h3Mode === "references"}
                    onElementsClick={() => setAssetsPickerOpen(true)}
                    placeholder={
                      h3Mode === "references"
                        ? "Describe the video. Refer to inputs as Image 1, Video 1, or Audio 1. Add elements using @"
                        : "Describe the video. Refer to the start and end frames as Image 1 and Image 2."
                    }
                  />
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={h3Duration}
                      onChange={setH3Duration}
                      min={minimaxH3Capabilities.duration.min}
                      max={minimaxH3Capabilities.duration.max}
                      inputName="standalone-minimax-h3-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={h3AspectRatio}
                      options={minimaxH3Capabilities.ratioOptions}
                      icon={RectangleHorizontal}
                      onChange={setH3AspectRatio}
                    />
                    {/* Static, non-clickable resolution chip — a div in the
                        reference, not a pill button. */}
                    <div className="flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white/[0.05] px-2 text-xs font-semibold text-white">
                      <Diamond className="size-3.5 shrink-0 text-zinc-400" />
                      {minimaxH3Capabilities.staticResolution}
                    </div>
                  </div>
                </>
              ) : seedance25Capabilities ? (
                <>
                  <SegmentModeSwitch
                    value={seedance25Mode}
                    onChange={setSeedance25Mode}
                    ariaLabel="Seedance 2.5 input mode"
                    options={[
                      { value: "references", label: "References" },
                      { value: "extend", label: "Extend Video" },
                    ]}
                  />
                  {seedance25Mode === "references" ? (
                    <SeedanceMediaUpload
                      selected={Boolean(seedance25ReferenceMedia)}
                      onClick={() =>
                        setCreatePickerTarget("seedance25-references")
                      }
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <AssetsCardButton
                        title="Add video to extend"
                        helper="Up to 30s"
                        icon={Video}
                        selected={Boolean(seedance25ExtendVideo)}
                        onClick={() =>
                          setCreatePickerTarget("seedance25-extend-video")
                        }
                      />
                      <AssetsCardButton
                        title="Add elements or references"
                        helper="Up to 50 image or audio"
                        icon={Plus}
                        selected={Boolean(seedance25ExtendReferences)}
                        onClick={() =>
                          setCreatePickerTarget("seedance25-extend-references")
                        }
                      />
                    </div>
                  )}
                  <SeedancePromptCard
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    onElementsClick={() => setAssetsPickerOpen(true)}
                    showAudioToggle
                    toggleVariant="enhance"
                    audioEnabled={seedance25Enhance}
                    onAudioEnabledChange={setSeedance25Enhance}
                    placeholder="Describe the video. Refer to inputs as Image 1, Video 1, or Audio 1. Add elements using @"
                  />
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={seedance25Duration}
                      onChange={setSeedance25Duration}
                      min={seedance25Capabilities.duration.min}
                      max={seedance25Capabilities.duration.max}
                      inputName="standalone-seedance-25-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={seedance25AspectRatio}
                      options={seedance25Capabilities.ratioOptions}
                      icon={RectangleHorizontal}
                      onChange={setSeedance25AspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={seedance25Resolution}
                      options={seedance25Capabilities.resolutionOptions}
                      icon={Diamond}
                      onChange={setSeedance25Resolution}
                    />
                  </div>
                  <SeedanceBitrateControl
                    value={seedance25Bitrate}
                    onChange={setSeedance25Bitrate}
                  />
                  {seedance25Mode === "extend" && (
                    <SeedanceDirectionControl
                      value={seedance25Direction}
                      onChange={setSeedance25Direction}
                    />
                  )}
                </>
              ) : flux3Capabilities ? (
                <>
                  <PresetFigure
                    subtitle={selectedModel.name}
                    presetName={presetName}
                    onOpenPresetSelector={onOpenPresetSelector}
                  />
                  <SegmentModeSwitch
                    value={fluxMode}
                    onChange={setFluxMode}
                    ariaLabel="FLUX.3 Video input mode"
                    options={[
                      { value: "frames", label: "Frames" },
                      { value: "video", label: "Video" },
                    ]}
                  />
                  {fluxMode === "frames" ? (
                    <AssetsCardButton
                      title="Add frame references"
                      helper="Up to 10 frames"
                      icon={ImageIcon}
                      selected={Boolean(fluxFrameRefs)}
                      onClick={() => setCreatePickerTarget("flux-frames")}
                    />
                  ) : (
                    <AssetsCardButton
                      title="Add a video to continue"
                      helper="Upload or choose a video"
                      icon={Video}
                      selected={Boolean(fluxVideoRef)}
                      onClick={() => setCreatePickerTarget("flux-video")}
                    />
                  )}
                  <SeedancePromptCard
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    showElements={false}
                    showAudioToggle
                    audioEnabled={fluxAudio}
                    onAudioEnabledChange={setFluxAudio}
                    placeholder="Describe the scene you imagine, with details."
                  />
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={fluxDuration}
                      onChange={setFluxDuration}
                      min={flux3Capabilities.duration.min}
                      max={flux3Capabilities.duration.max}
                      inputName="standalone-flux-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={fluxAspectRatio}
                      options={flux3Capabilities.ratioOptions}
                      icon={RectangleHorizontal}
                      onChange={setFluxAspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={fluxResolution}
                      options={flux3Capabilities.resolutionOptions}
                      icon={Diamond}
                      onChange={setFluxResolution}
                    />
                  </div>
                </>
              ) : sora2Capabilities ? (
                <>
                  <PresetFigure
                    subtitle={selectedModel.name}
                    presetName={presetName}
                    onOpenPresetSelector={onOpenPresetSelector}
                  />
                  <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <label className="relative flex h-[130px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]">
                      <div className="absolute right-2 top-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400 backdrop-blur-sm">
                        Optional
                      </div>
                      <input
                        type="file"
                        id="standalone-sora-imageUrl"
                        name="standalone-sora-imageUrl"
                        className="sr-only"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(event) =>
                          setSoraImageName(event.target.files?.[0]?.name ?? "")
                        }
                      />
                      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                        {soraImageName ? (
                          <Check className="size-4 text-[#D97757]" />
                        ) : (
                          <ImageIcon className="size-4 text-zinc-300" />
                        )}
                      </span>
                      <span className="mt-2 text-xs font-medium text-zinc-300">
                        {soraImageName || (
                          <>
                            Upload image or{" "}
                            <GenerateItSpan
                              onGenerateIt={() => router.push("/image")}
                            />
                          </>
                        )}
                      </span>
                      <span className="mt-1 text-[11px] font-medium text-zinc-500">
                        {soraImageName
                          ? "Ready to use"
                          : "PNG, JPG or Paste from clipboard"}
                      </span>
                    </label>
                  </div>
                  <div className="relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]">
                    <label
                      htmlFor="standalone-sora-prompt"
                      className="absolute left-3 top-3 text-xs font-medium text-zinc-500"
                    >
                      Prompt
                    </label>
                    <textarea
                      id="standalone-sora-prompt"
                      name="standalone-sora-prompt"
                      rows={4}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the scene you imagine, with details."
                      className="mt-8 min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={soraDuration}
                      onChange={setSoraDuration}
                      min={sora2Capabilities.duration.min}
                      max={sora2Capabilities.duration.max}
                      inputName="standalone-sora-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={soraAspectRatio}
                      options={sora2Capabilities.ratioOptions}
                      icon={RectangleHorizontal}
                      onChange={setSoraAspectRatio}
                    />
                  </div>
                  <a
                    href={sora2Capabilities.exploreHref}
                    className="block px-1 text-xs font-medium text-zinc-400 underline-offset-2 hover:text-white hover:underline"
                  >
                    {sora2Capabilities.exploreLabel}
                  </a>
                </>
              ) : seedanceCapabilities ? (
                <>
                  <SeedanceMediaUpload
                    selected={Boolean(seedanceMediaName)}
                    onClick={() =>
                      setCreatePickerTarget("seedance-references")
                    }
                  />
                  <SeedancePromptCard
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    audioEnabled={seedanceAudioEnabled}
                    onAudioEnabledChange={setSeedanceAudioEnabled}
                    onElementsClick={() => setAssetsPickerOpen(true)}
                    showAudioToggle={seedanceCapabilities.audioToggle}
                  />
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    {seedanceCapabilities.duration && (
                      <SeedanceDurationControl
                        value={seedanceDuration}
                        onChange={setSeedanceDuration}
                      />
                    )}
                    {seedanceCapabilities.aspectRatio && (
                      <SeedanceSelectControl
                        label="Aspect ratio"
                        value={seedanceAspectRatio}
                        options={ASPECT_RATIO_OPTIONS}
                        icon={RectangleHorizontal}
                        onChange={setSeedanceAspectRatio}
                      />
                    )}
                    {seedanceCapabilities.resolution && (
                      <SeedanceSelectControl
                        label="Resolution"
                        value={seedanceResolution}
                        options={RESOLUTION_OPTIONS}
                        icon={Diamond}
                        onChange={setSeedanceResolution}
                      />
                    )}
                  </div>
                  {seedanceCapabilities.bitrate && (
                    <SeedanceBitrateControl
                      value={seedanceBitrate}
                      onChange={setSeedanceBitrate}
                    />
                  )}
                </>
              ) : geminiCapabilities ? (
                <>
                  <SegmentModeSwitch
                    value={geminiInputMode}
                    onChange={setGeminiInputMode}
                    ariaLabel="Gemini input mode"
                    options={[
                      { value: "elements", label: "References" },
                      { value: "frames", label: "Frames" },
                    ]}
                  />
                  {geminiInputMode === "elements" ? (
                    <GeminiElementsInput
                      selected={Boolean(geminiElementsMedia)}
                      onClick={() => setGeminiPickerTarget("elements")}
                    />
                  ) : (
                    <GeminiFramesInput
                      startSelected={Boolean(geminiStartFrame)}
                      endSelected={Boolean(geminiEndFrame)}
                      onStartClick={() => setGeminiPickerTarget("startFrame")}
                      onEndClick={() => setGeminiPickerTarget("endFrame")}
                    />
                  )}
                  {geminiCapabilities.prompt && (
                    <GeminiPromptCard
                      prompt={prompt}
                      onPromptChange={setPrompt}
                      placeholder={
                        geminiInputMode === "elements"
                          ? "Describe the video. Refer to inputs as Image 1, Video 1, or Audio 1. Add elements using @"
                          : "Describe the video. Refer to the start and end frames as Image 1 and Image 2."
                      }
                    />
                  )}
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    {geminiCapabilities.duration.enabled && (
                      <SeedanceDurationControl
                        value={geminiDuration}
                        onChange={setGeminiDuration}
                        min={geminiCapabilities.duration.min}
                        max={geminiCapabilities.duration.max}
                        inputName="standalone-gemini-duration"
                      />
                    )}
                    {geminiCapabilities.aspectRatio.enabled && (
                      <SeedanceSelectControl
                        label="Aspect ratio"
                        value={geminiAspectRatio}
                        options={geminiCapabilities.aspectRatio.options}
                        icon={RectangleHorizontal}
                        onChange={setGeminiAspectRatio}
                      />
                    )}
                  </div>
                </>
              ) : happyHorseCapabilities ? (
                <>
                  <figure
                    className="relative aspect-[2.3] w-full select-none overflow-hidden rounded-xl group"
                    tabIndex={-1}
                    role="button"
                  >
                    <video
                      loop
                      playsInline
                      disablePictureInPicture
                      preload="none"
                      src="https://static.higgsfield.ai/happy-horse-preset-general.mp4"
                      className="size-full w-full h-full rounded-md object-cover object-contain"
                      onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                    >
                      Your browser does not support the video.
                    </video>
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 50%)",
                      }}
                    />
                    <figcaption className="absolute bottom-0 left-0 z-10 w-full pb-3 pl-3 pr-1.5">
                      <p className="w-full truncate text-lg font-black uppercase text-[#D97757]">
                        {presetName}
                      </p>
                      <p className="text-xs text-white/80">HappyHorse</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenPresetSelector("change")}
                        className="inline-flex h-6 items-center gap-1 rounded-lg border border-white/[0.06] bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-[#D97757] hover:text-black"
                      >
                        <Pencil className="size-3.5" />
                        Change
                      </button>
                    </div>
                  </figure>
                  <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <label
                      className="flex h-[130px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                    >
                      <input
                        type="file"
                        id="happy-horse-imageUrl"
                        name="happy-horse-imageUrl"
                        className="sr-only"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(event) =>
                          setHappyHorseImageName(
                            event.target.files?.[0]?.name ?? "",
                          )
                        }
                      />
                      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                        {happyHorseImageName ? (
                          <Check className="size-4 text-[#D97757]" />
                        ) : (
                          <ImageIcon className="size-4 text-zinc-300" />
                        )}
                      </span>
                      <span className="mt-2 text-xs font-medium text-zinc-300">
                        {happyHorseImageName || (
                          <>
                            Upload image or{" "}
                            <GenerateItSpan
                              onGenerateIt={() => router.push("/image")}
                            />
                          </>
                        )}
                      </span>
                      <span className="mt-1 text-[11px] font-medium text-zinc-500">
                        {happyHorseImageName
                          ? "Ready to use"
                          : "PNG, JPG or Paste from clipboard"}
                      </span>
                    </label>
                  </div>
                  <div className="relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]">
                    <label
                      htmlFor="happy-horse-prompt"
                      className="absolute left-3 top-3 text-xs font-medium text-zinc-500"
                    >
                      Prompt
                    </label>
                    <textarea
                      id="happy-horse-prompt"
                      name="happy-horse-prompt"
                      rows={4}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe your video scene..."
                      className="mt-8 min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={happyHorseDuration}
                      onChange={setHappyHorseDuration}
                      min={happyHorseCapabilities.duration.min}
                      max={happyHorseCapabilities.duration.max}
                      inputName="standalone-happyhorse-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={happyHorseAspectRatio}
                      options={happyHorseCapabilities.aspectRatio.options}
                      icon={RectangleHorizontal}
                      onChange={setHappyHorseAspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={happyHorseResolution}
                      options={happyHorseCapabilities.resolution.options}
                      icon={Diamond}
                      onChange={setHappyHorseResolution}
                    />
                  </div>
                </>
              ) : grokCapabilities ? (
                <>
                  <figure
                    className="relative aspect-[2.3] w-full select-none overflow-hidden rounded-xl group"
                    tabIndex={-1}
                    role="button"
                  >
                    <video
                      loop
                      playsInline
                      disablePictureInPicture
                      preload="none"
                      src={grokCapabilities.presetVideo}
                      className="size-full w-full h-full rounded-md object-cover object-contain"
                      onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                    >
                      Your browser does not support the video.
                    </video>
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 50%)",
                      }}
                    />
                    <figcaption className="absolute bottom-0 left-0 z-10 w-full pb-3 pl-3 pr-1.5">
                      <p className="w-full truncate text-lg font-black uppercase text-[#D97757]">
                        {presetName}
                      </p>
                      <p className="text-xs text-white/80">{grokCapabilities.subtitle}</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenPresetSelector("change")}
                        className="inline-flex h-6 items-center gap-1 rounded-lg border border-white/[0.06] bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-[#D97757] hover:text-black"
                      >
                        <Pencil className="size-3.5" />
                        Change
                      </button>
                    </div>
                  </figure>
                  <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <label
                      className="relative flex h-[130px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                    >
                      {grokCapabilities.optionalUpload && (
                        <div className="absolute right-2 top-2 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400 backdrop-blur-sm">
                          Optional
                        </div>
                      )}
                      <input
                        type="file"
                        id="grok-imageUrl"
                        name="grok-imageUrl"
                        className="sr-only"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        onChange={(event) =>
                          setGrokImageName(
                            event.target.files?.[0]?.name ?? "",
                          )
                        }
                      />
                      <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                        {grokImageName ? (
                          <Check className="size-4 text-[#D97757]" />
                        ) : (
                          <ImageIcon className="size-4 text-zinc-300" />
                        )}
                      </span>
                      <span className="mt-2 text-xs font-medium text-zinc-300">
                        {grokImageName || (
                          <>
                            Upload image or{" "}
                            <GenerateItSpan
                              onGenerateIt={() => router.push("/image")}
                            />
                          </>
                        )}
                      </span>
                      <span className="mt-1 text-[11px] font-medium text-zinc-500">
                        {grokImageName
                          ? "Ready to use"
                          : "PNG, JPG or Paste from clipboard"}
                      </span>
                    </label>
                  </div>
                  <div className="relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]">
                    <label
                      htmlFor="grok-prompt"
                      className="absolute left-3 top-3 text-xs font-medium text-zinc-500"
                    >
                      Prompt
                    </label>
                    <textarea
                      id="grok-prompt"
                      name="grok-prompt"
                      rows={4}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the scene you imagine, with details."
                      className="mt-8 min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="flex gap-2">
                    {grokCapabilities.durationMode === "slider" ? (
                      <SeedanceDurationControl
                        value={grokDurationNum}
                        onChange={setGrokDurationNum}
                        min={grokCapabilities.durationSlider!.min}
                        max={grokCapabilities.durationSlider!.max}
                        inputName="standalone-grok-duration"
                      />
                    ) : (
                      <SeedanceSelectControl
                        label="Duration"
                        value={grokDurationStr}
                        options={grokCapabilities.durationOptions!}
                        icon={Clock3}
                        onChange={setGrokDurationStr}
                      />
                    )}
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={grokAspectRatio}
                      options={grokCapabilities.aspectRatioOptions}
                      icon={RectangleHorizontal}
                      onChange={setGrokAspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={grokResolution}
                      options={grokCapabilities.resolutionOptions}
                      icon={Diamond}
                      onChange={setGrokResolution}
                    />
                  </div>
                </>
              ) : klingCapabilities ? (
                <>
                  {/* Preset banner card */}
                  <figure
                    className="relative aspect-[2.3] w-full select-none overflow-hidden rounded-xl group"
                    tabIndex={-1}
                    role="button"
                  >
                    <video
                      loop
                      playsInline
                      disablePictureInPicture
                      preload="none"
                      src={klingCapabilities.presetVideo}
                      className="size-full w-full h-full rounded-md object-cover object-contain"
                      onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                    >
                      Your browser does not support the video.
                    </video>
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 50%)",
                      }}
                    />
                    <figcaption className="absolute bottom-0 left-0 z-10 w-full pb-3 pl-3 pr-1.5">
                      <p className="w-full truncate text-lg font-black uppercase text-[#D97757]">
                        {presetName}
                      </p>
                      <p className="text-xs text-white/80">{klingCapabilities.subtitle}</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenPresetSelector("change")}
                        className="inline-flex h-6 items-center gap-1 rounded-lg border border-white/[0.06] bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-[#D97757] hover:text-black"
                      >
                        <Pencil className="size-3.5" />
                        Change
                      </button>
                    </div>
                  </figure>

                  {klingCapabilities.dualFrames ? (
                    /* Dual Start/End frame dropzone — Kling 3.0 */
                    <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" style={{ height: 146 }}>
                      <div className="grid h-full w-full grid-cols-2 gap-1">
                        {/* Start frame */}
                        <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]">
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/jpeg,image/jpg,image/png,image/webp"
                            onChange={(e) => setKling3StartFrame(e.target.files?.[0]?.name ?? "")}
                          />
                          <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                            {kling3StartFrame ? (
                              <Check className="size-4 text-[#D97757]" />
                            ) : (
                              <ImageIcon className="size-4 text-zinc-300" />
                            )}
                          </span>
                          <span className="mt-1.5 text-xs font-medium text-zinc-300">
                            {kling3StartFrame || "Start frame"}
                          </span>
                          <span className="mt-0.5 text-[10px] font-medium text-zinc-500">Optional</span>
                        </label>
                        {/* End frame */}
                        <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]">
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/jpeg,image/jpg,image/png,image/webp"
                            onChange={(e) => setKling3EndFrame(e.target.files?.[0]?.name ?? "")}
                          />
                          <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                            {kling3EndFrame ? (
                              <Check className="size-4 text-[#D97757]" />
                            ) : (
                              <ImageIcon className="size-4 text-zinc-300" />
                            )}
                          </span>
                          <span className="mt-1.5 text-xs font-medium text-zinc-300">
                            {kling3EndFrame || "End frame"}
                          </span>
                          <span className="mt-0.5 text-[10px] font-medium text-zinc-500">Optional</span>
                        </label>
                      </div>
                    </div>
                  ) : (
                    /* Single upload — Kling 3.0 Turbo */
                    <div className="rounded-[20px] border border-white/[0.07] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <label
                        className="relative flex h-[130px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-2 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                      >
                        <input
                          type="file"
                          id="kling3-turbo-imageUrl"
                          name="kling3-turbo-imageUrl"
                          className="sr-only"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          onChange={(event) =>
                            setKlingImageName(
                              event.target.files?.[0]?.name ?? "",
                            )
                          }
                        />
                        <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner mix-blend-screen">
                          {klingImageName ? (
                            <Check className="size-4 text-[#D97757]" />
                          ) : (
                            <ImageIcon className="size-4 text-zinc-300" />
                          )}
                        </span>
                        <span className="mt-2 text-xs font-medium text-zinc-300">
                          {klingImageName || (
                            <>
                              Upload image or{" "}
                              <span className="cursor-pointer text-[#D97757] hover:underline">
                                generate it
                              </span>
                            </>
                          )}
                        </span>
                        <span className="mt-1 text-[11px] font-medium text-zinc-500">
                          {klingImageName
                            ? "Ready to use"
                            : "PNG, JPG or Paste from clipboard"}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Multi-shot control — Kling 3.0 only */}
                  {klingCapabilities.multiShot && (
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]">
                      <div className="flex items-center justify-between px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Film className="size-3.5 text-zinc-400" />
                          <span className={`text-xs font-medium ${kling3MultiShot ? "text-white" : "text-zinc-400"}`}>
                            Multi-shot
                          </span>
                          <span className="group/msinfo relative flex items-center">
                            <button
                              type="button"
                              aria-label="Multi-shot info"
                              className="flex items-center text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:outline-none"
                            >
                              <Info className="size-3.5" />
                            </button>
                            <span
                              role="tooltip"
                              className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-[#1d2022] p-2 text-[11px] font-normal leading-4 text-zinc-300 opacity-0 shadow-2xl shadow-black/60 transition-opacity duration-150 group-hover/msinfo:opacity-100 group-focus-within/msinfo:opacity-100"
                            >
                              Create several shots and combine them into one
                              video (max 15s total)
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={kling3MultiShot}
                          onClick={() => setKling3MultiShot((v) => !v)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                            kling3MultiShot ? "bg-[#4ade80]" : "bg-zinc-700"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              kling3MultiShot ? "translate-x-[18px]" : "translate-x-[3px]"
                            }`}
                          />
                        </button>
                      </div>
                      {kling3MultiShot && (
                        <div className="px-3 pb-3">
                          <div className="flex rounded-xl bg-[#131517] p-1 border border-white/[0.04]">
                            {["Auto", "Custom"].map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setKling3MultiShotMode(mode)}
                                className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                  kling3MultiShotMode === mode
                                    ? "bg-[#2E3031] text-white"
                                    : "text-zinc-400 hover:text-zinc-300"
                                }`}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {kling3CustomShotsActive ? (
                    /* Custom multi-shot: per-shot blocks replace the global
                       prompt (and the global Duration pill below). */
                    <>
                      {kling3Shots.map((shot, index) => (
                        <div
                          key={index}
                          className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 md:bg-[#1c1e20]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white">
                              Shot {index + 1}
                            </span>
                            {index > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setKling3Shots((shots) =>
                                    shots.filter((_, i) => i !== index),
                                  )
                                }
                                className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-red-300"
                              >
                                Remove shot {index + 1}
                              </button>
                            )}
                          </div>
                          <textarea
                            rows={3}
                            name={`standalone-kling-shot-${index + 1}-prompt`}
                            value={shot.prompt}
                            onChange={(event) => {
                              const value = event.target.value;
                              setKling3Shots((shots) =>
                                shots.map((s, i) =>
                                  i === index ? { ...s, prompt: value } : s,
                                ),
                              );
                            }}
                            placeholder={
                              index === 0
                                ? "Describe the first scene you imagine, with details."
                                : `Describe scene ${index + 1}...`
                            }
                            className="mt-2 min-h-[72px] w-full resize-none bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                          />
                          <div className="mt-2 flex items-center gap-1.5">
                            <SeedanceDurationControl
                              value={shot.duration}
                              onChange={(duration) =>
                                setKling3Shots((shots) =>
                                  shots.map((s, i) =>
                                    i === index ? { ...s, duration } : s,
                                  ),
                                )
                              }
                              min={klingCapabilities.durationSlider.min}
                              max={klingCapabilities.durationSlider.max}
                              inputName={`standalone-kling-shot-${index + 1}-duration`}
                            />
                            <button
                              type="button"
                              onClick={() => setKling3ElementsOpen(true)}
                              className="inline-flex h-10 items-center gap-1 rounded-lg bg-[#131517] px-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:text-white"
                            >
                              <AtSign className="size-3.5" />
                              Elements
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setKling3Shots((shots) => [
                            ...shots,
                            { prompt: "", duration: 3 },
                          ])
                        }
                        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
                      >
                        <Plus className="size-3.5" />
                        Add shot
                      </button>
                    </>
                  ) : (
                    /* Prompt area — raised dark surface for Kling 3.0, flat for Turbo */
                    <div className={`relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-hidden ${
                      klingCapabilities.surfaceStyle === "raised"
                        ? "rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#1c1e20]"
                        : "rounded-xl border border-white/[0.07] bg-white/[0.035] md:bg-[#17191b]"
                    }`}>
                      <label
                        htmlFor="kling-prompt"
                        className="absolute left-3 top-3 text-xs font-medium text-zinc-500"
                      >
                        Prompt
                      </label>
                      <textarea
                        id="kling-prompt"
                        name="kling-prompt"
                        rows={4}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder={'Describe your video, like "A woman walking through a neon-lit city". Add elements using @'}
                        className="mt-8 min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 pb-3 text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                      />
                    </div>
                  )}

                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />

                  <div className="flex gap-2">
                    {!kling3CustomShotsActive && (
                      <SeedanceDurationControl
                        value={
                          klingCapabilities.multiShot
                            ? kling3DurationNum
                            : klingDurationNum
                        }
                        onChange={
                          klingCapabilities.multiShot
                            ? setKling3DurationNum
                            : setKlingDurationNum
                        }
                        min={klingCapabilities.durationSlider.min}
                        max={klingCapabilities.durationSlider.max}
                        inputName="standalone-kling-duration"
                      />
                    )}
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={klingAspectRatio}
                      options={klingCapabilities.aspectRatioOptions}
                      icon={RectangleHorizontal}
                      onChange={setKlingAspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={
                        klingCapabilities.multiShot
                          ? kling3Resolution
                          : klingResolution
                      }
                      options={klingCapabilities.resolutionOptions}
                      icon={Diamond}
                      onChange={
                        klingCapabilities.multiShot
                          ? setKling3Resolution
                          : setKlingResolution
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <UploadSurface
                    title="Upload image or generate it"
                    description="PNG, JPG or Paste from clipboard"
                    icon={ImagePlus}
                    onGenerateIt={() => router.push("/image")}
                  />
                  <label className="block rounded-xl bg-white/[0.035] p-3">
                    <span className="text-xs font-semibold text-zinc-300">
                      Prompt
                    </span>
                    <textarea
                      rows={3}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Describe the scene you imagine, with details."
                      className="mt-1 w-full resize-none bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                    />
                  </label>
                  <ModelTrigger
                    model={selectedModel}
                    open={modelOpen}
                    onClick={openModelPanel}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <label className="rounded-lg bg-white/[0.035] px-2 py-2">
                      <span className="sr-only">Duration</span>
                      <select
                        value={duration}
                        onChange={(event) => setDuration(event.target.value)}
                        className="w-full bg-transparent text-xs font-semibold text-white outline-none"
                      >
                        <option className="bg-zinc-900">5s</option>
                        <option className="bg-zinc-900">8s</option>
                        <option className="bg-zinc-900">12s</option>
                      </select>
                    </label>
                    <label className="rounded-lg bg-white/[0.035] px-2 py-2">
                      <span className="sr-only">Aspect ratio</span>
                      <select
                        value={aspectRatio}
                        onChange={(event) => setAspectRatio(event.target.value)}
                        className="w-full bg-transparent text-xs font-semibold text-white outline-none"
                      >
                        <option className="bg-zinc-900">16:9</option>
                        <option className="bg-zinc-900">9:16</option>
                        <option className="bg-zinc-900">1:1</option>
                      </select>
                    </label>
                    <label className="rounded-lg bg-white/[0.035] px-2 py-2">
                      <span className="sr-only">Resolution</span>
                      <select
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        className="w-full bg-transparent text-xs font-semibold text-white outline-none"
                      >
                        <option className="bg-zinc-900">720p</option>
                        <option className="bg-zinc-900">1080p</option>
                        <option className="bg-zinc-900">4K</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          {workflow === "edit-video" &&
            (isReframe ? (
              /* Cinefield Reframe variant: preview + How it works, one
                 upload card, model row, Ratio (no Auto) + Quality pills.
                 No prompt, no Edit method, no Elements, no Bitrate. */
              <>
                <WorkflowBanner workflow={workflow} model={selectedModel} />
                <UploadSurface
                  title="Upload a video to reframe"
                  description="Duration required: 4 secs–1 min"
                  icon={Video}
                  accept="video/mp4,video/quicktime"
                  fileName={reframeVideoName}
                  onFileNameChange={setReframeVideoName}
                />
                <ModelTrigger
                  model={selectedModel}
                  open={modelOpen}
                  onClick={openModelPanel}
                />
                <div className="flex gap-2">
                  <SeedanceSelectControl
                    label="Ratio"
                    value={reframeRatio}
                    options={REFRAME_RATIO_OPTIONS}
                    icon={RectangleHorizontal}
                    onChange={setReframeRatio}
                  />
                  <SeedanceSelectControl
                    label="Quality"
                    value={reframeQuality}
                    options={REFRAME_QUALITY_OPTIONS}
                    icon={Diamond}
                    onChange={setReframeQuality}
                  />
                </div>
              </>
            ) : (
              /* Seedance 2.5 Edit layout (all other edit models) */
              <>
                {/* Preview card: General overlay + model name; Change (no
                    Mix) jumps to the Create Video tab and opens the preset
                    selector, matching the reference. */}
                <SeedanceBanner
                  modelName={selectedModel.name}
                  presetName={presetName}
                  onChangeClick={() => {
                    changeWorkflow("create-video");
                    onOpenPresetSelector("change");
                  }}
                />
                <div
                  role="group"
                  aria-label="Edit method"
                  className="grid grid-cols-2 rounded-xl bg-white/[0.035] p-1"
                >
                  {(["prompt", "draw"] as const).map((method) => {
                    // Draw stays inert until a video has been added.
                    const locked = method === "draw" && !editVideoSelected;
                    return (
                      <button
                        key={method}
                        type="button"
                        aria-pressed={editMethod === method}
                        aria-disabled={locked || undefined}
                        disabled={locked}
                        onClick={() => setEditMethod(method)}
                        className={`h-9 rounded-lg text-sm font-semibold transition-colors ${
                          editMethod === method
                            ? "bg-white/10 text-white"
                            : locked
                              ? "cursor-not-allowed text-zinc-600"
                              : "text-zinc-500 hover:text-zinc-200"
                        }`}
                      >
                        {method === "prompt" ? "Prompt" : "Draw"}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <AssetsCardButton
                    title="Add a video to edit"
                    helper="Up to 30s"
                    icon={Video}
                    selected={editVideoSelected}
                    onClick={() => setCreatePickerTarget("edit-video")}
                  />
                  <AssetsCardButton
                    title="Add elements or references"
                    helper="Up to 50 image or audio"
                    icon={Plus}
                    selected={editReferencesSelected}
                    onClick={() => setCreatePickerTarget("edit-references")}
                  />
                </div>
                <SeedancePromptCard
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onElementsClick={() => setAssetsPickerOpen(true)}
                  showAudioToggle
                  toggleVariant="enhance"
                  audioEnabled={editEnhance}
                  onAudioEnabledChange={setEditEnhance}
                  placeholder="Describe what to change in the video. Add reference images or elements using @…"
                />
                <ModelTrigger
                  model={selectedModel}
                  open={modelOpen}
                  onClick={openModelPanel}
                />
                <div className="flex gap-2">
                  <SeedanceSelectControl
                    label="Resolution"
                    value={editResolution}
                    options={EDIT_RESOLUTION_OPTIONS}
                    icon={Diamond}
                    onChange={setEditResolution}
                  />
                </div>
                <SeedanceBitrateControl
                  value={editBitrate}
                  onChange={setEditBitrate}
                />
              </>
            ))}

          {workflow === "motion-control" && motionState && (
            <KlingMotionControlForm
              model={selectedModel}
              state={motionState}
              onChange={(patch) => updateMotionState(selectedModel.id, patch)}
              onHowItWorks={onToggleMotionTutorial}
              onOpenModelPanel={openModelPanel}
              modelOpen={modelOpen}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.07] p-3">
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-black transition-transform active:translate-y-0.5 disabled:cursor-wait disabled:opacity-70 ${
              seedanceCapabilities
                ? "bg-[#D97757] shadow-[0_5px_0_#934c36]"
                : "bg-[#D97757] shadow-[0_5px_0_#934c36]"
            }`}
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {generating ? (
              "GENERATING"
            ) : cinefieldCapabilities ? (
              `Generate  ✦ ${cinefieldCapabilities.credits}`
            ) : minimaxH3Capabilities ? (
              `Generate  ✦ ${minimaxH3Capabilities.credits}`
            ) : seedance25Capabilities ? (
              <>
                Generate  ✦{" "}
                <s className="text-black/50">
                  {seedance25Capabilities.strikethroughCredits}
                </s>{" "}
                {seedance25Capabilities.credits}
              </>
            ) : flux3Capabilities ? (
              `Generate  ✦ ${flux3Capabilities.credits}`
            ) : sora2Capabilities ? (
              `Generate  ✦ ${sora2Capabilities.credits}`
            ) : geminiCapabilities ? (
              "Generate  ✦ 24"
            ) : grokCapabilities ? (
              `Generate  ✦ ${grokCapabilities.credits}`
            ) : klingCapabilities ? (
              `Generate  ✦ ${
                kling3CustomShotsActive
                  ? 18 * kling3Shots.length
                  : klingCapabilities.credits
              }`
            ) : workflow === "edit-video" ? (
              // Reference: Edit Video's Generate carries NO credit badge.
              "Generate"
            ) : workflow === "motion-control" && motionState ? (
              `Generate  ✦ ${getMotionControlCredits(
                selectedModel.id,
                motionState,
              )}`
            ) : (
              "Generate  ✦ 7.5"
            )}
          </button>
        </div>
      </aside>

      {modelOpen && (
        <WorkflowModelPanel
          workflow={workflow}
          models={models}
          selectedIndex={selectedIndex}
          onSelect={selectModel}
          onClose={() => setModelOpen(false)}
        />
      )}
      {/* Every assets-picker call type shares one picker (audit 2.5), so
          the Elements and Gemini media cards open the same 600x672 overlay
          as the references / edit_video / edit_references cards. */}
      <VideoAssetsPicker
        isOpen={assetsPickerOpen}
        onClose={() => setAssetsPickerOpen(false)}
        defaultTab="elements"
        accept="image/*,video/*,audio/*"
        onSelectAsset={(url) =>
          setElementReferences((current) => [...current, url])
        }
      />
      <VideoAssetsPicker
        isOpen={geminiPickerTarget !== null}
        onClose={() => setGeminiPickerTarget(null)}
        accept={
          geminiPickerTarget === "elements" ? "image/*,video/*" : "image/*"
        }
        onSelectAsset={(url) => {
          if (geminiPickerTarget === "elements") {
            setGeminiElementsMedia(url);
          } else if (geminiPickerTarget === "startFrame") {
            setGeminiStartFrame(url);
          } else if (geminiPickerTarget === "endFrame") {
            setGeminiEndFrame(url);
          }
        }}
      />
      <VideoAssetsPicker
        isOpen={kling3ElementsOpen}
        onClose={() => setKling3ElementsOpen(false)}
        defaultTab="elements"
        accept="image/*,video/*"
        onSelectAsset={(url) =>
          setElementReferences((current) => [...current, url])
        }
      />
      {/* The audited shared assets picker (references / edit_video /
          edit_references): fixed 600x672 overlay beside the left panel,
          Uploads…Audio Generations tabs, Filter + "Upload file", "No
          uploads found" empty state. */}
      <VideoAssetsPicker
        isOpen={createPickerTarget !== null}
        onClose={() => setCreatePickerTarget(null)}
        accept={
          createPickerTarget
            ? CREATE_PICKER_ACCEPT[createPickerTarget]
            : "image/*,video/*,audio/*"
        }
        onSelectAsset={(url) => {
          switch (createPickerTarget) {
            case "seedance-references":
              setSeedanceMediaName(url);
              break;
            case "seedance25-references":
              setSeedance25ReferenceMedia(url);
              break;
            case "seedance25-extend-video":
              setSeedance25ExtendVideo(url);
              break;
            case "seedance25-extend-references":
              setSeedance25ExtendReferences(url);
              break;
            case "h3-references":
              setH3ReferenceMedia(url);
              break;
            case "h3-start-frame":
              setH3StartFrame(url);
              break;
            case "h3-end-frame":
              setH3EndFrame(url);
              break;
            case "flux-frames":
              setFluxFrameRefs(url);
              break;
            case "flux-video":
              setFluxVideoRef(url);
              break;
            case "edit-video":
              if (isOmniEdit) setOmniEditVideoName(url);
              else setEditVideoAssetName(url);
              break;
            case "edit-references":
              if (isOmniEdit) setOmniEditSupportingName(url);
              else setEditReferencesAssetName(url);
              break;
          }
        }}
      />
    </div>
  );
}

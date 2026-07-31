"use client";

import {
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
  Loader2,
  LockKeyhole,
  Music2,
  Move3d,
  Pencil,
  Plus,
  RectangleHorizontal,
  Search,
  Scissors,
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
  type ElementType,
} from "react";
import { useSearchParams } from "next/navigation";
import AssetsPickerModal from "@/components/cinema-studio/AssetsPickerModal";
import {
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
    name: "Higgsfield DOP",
    description: "VFX and camera control",
    icon: Clapperboard,
    quality: "1080p",
    duration: "3s-10s",
  },
];

const EDIT_MODELS: WorkflowModel[] = [
  {
    id: "gemini-omni-flash-edit",
    name: "Gemini Omni Flash",
    description: "Edit videos with images and prompts",
    icon: GoogleIcon,
    badge: "NEW",
  },
  {
    id: "higgsfield-reframe",
    name: "Higgsfield Reframe",
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
    name: "Higgsfield",
    description: "Advanced camera controls and effect presets",
    icon: Clapperboard,
    modelNames: [
      "Cinematic Studio Video 3.5",
      "Higgsfield Lite",
      "Higgsfield Standard",
      "Higgsfield Turbo",
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
  { id: "higgsfield-lite", name: "Higgsfield Lite", description: "Lightweight cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { id: "higgsfield-standard", name: "Higgsfield Standard", description: "Standard cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { id: "higgsfield-turbo", name: "Higgsfield Turbo", description: "Fast cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
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
  "create-video": 0,
  "edit-video": 2,
  "motion-control": 5,
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
      min: 3,
      max: 10,
      default: 10,
    },
    aspectRatio: {
      enabled: true,
      options: ["16:9", "9:16"],
      default: "9:16",
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
  /** Kling 3.0 has action row (enhance, sound, elements) */
  actionRow?: boolean;
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
    actionRow: true,
  },
};

const ASPECT_RATIO_OPTIONS = ["Auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const RESOLUTION_OPTIONS = ["480p", "720p"];

const WORKFLOW_MODELS: Record<StandaloneVideoWorkflow, WorkflowModel[]> = {
  "create-video": CREATE_MODELS,
  "edit-video": EDIT_MODELS,
  "motion-control": MOTION_CONTROL_MODELS,
};

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
  "Higgsfield DOP": {
    workflow: "create-video",
    modelName: "Higgsfield DOP",
  },
};

function UploadSurface({
  title,
  description,
  compact = false,
  icon: Icon = Upload,
  fileName: controlledFileName,
  onFileNameChange,
  accept = "image/*,video/*",
}: {
  title: string;
  description: string;
  compact?: boolean;
  icon?: LucideIcon;
  fileName?: string;
  onFileNameChange?: (name: string) => void;
  accept?: string;
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
        {fileName || title}
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
      subtitle: "Kling 3.0 Turbo",
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
            ? "border-[#d1fe17]/30 bg-[#d1fe17] text-black"
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
  onSelect: (index: number) => void;
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
          <p className="px-2 py-1.5 text-[11px] text-zinc-500">
            {workflow === "create-video" ? "Featured models" : "All models"}
          </p>
          {filtered.map(({ model, index }) => {
            const Icon = model.icon;
            const unavailable = model.disabled || model.available === false;
            const selected = !unavailable && index === selectedIndex;
            const dangerIcon = model.iconTone === "danger";
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => {
                  if (!unavailable) onSelect(index);
                }}
                aria-pressed={selected}
                aria-disabled={unavailable || undefined}
                disabled={unavailable}
                className={`group/model flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                  selected
                    ? "bg-white/[0.07]"
                    : unavailable
                      ? "cursor-not-allowed opacity-75"
                      : "hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] transition-[color,background-color,box-shadow] duration-200 ${
                    dangerIcon
                      ? "text-red-400 group-hover/model:bg-red-500/10 group-hover/model:text-red-400 group-hover/model:shadow-[0_0_14px_rgba(248,113,113,0.28)]"
                      : "group-hover/model:bg-[#D97757]/10 group-hover/model:text-[#D97757] group-hover/model:shadow-[0_0_14px_rgba(217,119,87,0.45)]"
                  } ${
                    selected && !dangerIcon
                      ? "bg-[#D97757]/10 text-[#D97757] shadow-[0_0_14px_rgba(217,119,87,0.35)]"
                      : dangerIcon
                        ? ""
                        : "text-zinc-400"
                  }`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-[16px] font-semibold leading-5 ${model.name.includes("Higgsfield") ? "text-red-500" : "text-white"}`}>
                      {model.name}
                    </span>
                    {model.badge === "COMING_SOON" && (
                      <ModelBadgePill
                        badge={model.badge}
                        tone={model.badgeTone}
                      />
                    )}
                    {model.audio && (
                      <Video className="size-3.5 text-zinc-500" />
                    )}
                  </span>
                  {workflow === "create-video" ? (
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
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {model.description}
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
                          onSelect(groupIndexes[0]);
                        }
                      }}
                      className={`group/model flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                        selected || active
                          ? "bg-white/[0.07]"
                          : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] transition-[color,background-color,box-shadow] duration-200 group-hover/model:bg-[#D97757]/10 group-hover/model:text-[#D97757] group-hover/model:shadow-[0_0_14px_rgba(217,119,87,0.45)] ${
                          selected
                            ? "bg-[#D97757]/10 text-[#D97757] shadow-[0_0_14px_rgba(217,119,87,0.35)]"
                            : "text-zinc-400"
                        }`}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold leading-5 text-white">
                          {group.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {group.description}
                        </span>
                      </span>
                      {expandable ? (
                        <ChevronDown
                          className="size-4 shrink-0 -rotate-90 text-zinc-500"
                        />
                      ) : selected ? (
                        <Check className="size-4 shrink-0 text-[#D97757]" />
                      ) : null}
                    </button>
                  </div>
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
                  if (!unavailable) {
                    cancelFlyoutClose();
                    setActiveGroupName(null);
                    onSelect(index);
                  }
                }}
                aria-pressed={selected}
                aria-disabled={unavailable || undefined}
                disabled={unavailable}
                className={`relative w-full rounded-xl px-3 py-2.5 pr-9 text-left transition-colors ${
                  selected
                    ? "bg-white/[0.07]"
                    : unavailable
                      ? "cursor-not-allowed opacity-75"
                      : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[16px] font-semibold leading-5 text-white">
                    {model.name}
                  </span>
                  {model.badge === "COMING_SOON" && (
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
                {unavailable && (
                  <LockKeyhole className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-red-400" />
                )}
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
  onClick,
}: {
  model: WorkflowModel;
  onClick: () => void;
}) {
  const Icon = model.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5 text-left hover:bg-white/[0.06]"
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
      <ChevronDown className="size-4 -rotate-90 text-zinc-500" />
    </button>
  );
}

function SeedanceBanner({ modelName }: { modelName: string }) {
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
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-zinc-200 backdrop-blur-sm"
      >
        <Pencil className="size-3" />
        Change
      </button>
      <div className="absolute bottom-3 left-3">
        <p className="text-lg font-black text-[#d1fe17]">GENERAL</p>
        <p className="mt-0.5 text-xs text-zinc-300">{modelName}</p>
      </div>
    </div>
  );
}

function SeedanceMediaUpload({
  fileName,
  onFileNameChange,
}: {
  fileName: string;
  onFileNameChange: (name: string) => void;
}) {
  return (
    <label className="flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035] p-4 text-center transition-colors hover:border-white/25 hover:bg-white/[0.05]">
      <input
        type="file"
        name="standalone-seedance-media"
        className="sr-only"
        accept="image/*,video/*,audio/*"
        onChange={(event) =>
          onFileNameChange(event.target.files?.[0]?.name ?? "")
        }
      />
      <span className="flex h-10 items-center justify-center">
        <span className="-mr-1 flex size-9 -rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
          <ImageIcon className="size-3 text-zinc-300" />
        </span>
        <span className="relative z-10 flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.09] shadow-inner">
          {fileName ? (
            <Check className="size-3.5 text-[#d1fe17]" />
          ) : (
            <Video className="size-3 text-zinc-200" />
          )}
        </span>
        <span className="-ml-1 flex size-9 rotate-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] shadow-inner">
          <Music2 className="size-3 text-zinc-300" />
        </span>
      </span>
      <span className="mt-2 text-xs font-medium text-zinc-300">
        {fileName || "Upload media"}
      </span>
      <span className="mt-1 text-[11px] font-medium text-zinc-500">
        {fileName ? "Ready to use" : "Image, Video or Audio"}
      </span>
    </label>
  );
}

function SeedancePromptCard({
  prompt,
  onPromptChange,
  audioEnabled,
  onAudioEnabledChange,
  onElementsClick,
  showAudioToggle,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  audioEnabled: boolean;
  onAudioEnabledChange: (value: boolean) => void;
  onElementsClick: () => void;
  showAudioToggle: boolean;
}) {
  const AudioIcon = audioEnabled ? Volume2 : VolumeX;
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
        placeholder="Describe your scene in detail. Use @ to reference assets"
        className="mt-1 min-h-0 flex-1 resize-none bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onElementsClick}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#131517] px-1.5 py-1 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06]"
        >
          <AtSign className="size-3" />
          Elements
        </button>
        {showAudioToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={audioEnabled}
            onClick={() => onAudioEnabledChange(!audioEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-[#131517] px-1.5 py-1 text-xs font-semibold ${
              audioEnabled ? "text-white" : "text-zinc-500"
            }`}
          >
            <AudioIcon className="size-3" />
            {audioEnabled ? "On" : "Off"}
          </button>
        )}
      </div>
    </div>
  );
}

function GeminiInputModeSwitch({
  value,
  onChange,
}: {
  value: "elements" | "frames";
  onChange: (value: "elements" | "frames") => void;
}) {
  const options = [
    { value: "elements" as const, label: "Elements" },
    { value: "frames" as const, label: "Frames" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Gemini input mode"
      className="mb-4 grid grid-cols-2 rounded-xl bg-white/[0.035] p-1"
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
        <span className="flex h-10 items-center justify-center">
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
          Upload media
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
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
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
        placeholder="Describe your scene in detail. Use @ to reference media"
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
                  "--duration-progress": `${((value - min) / (max - min)) * 100}%`,
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

function SeedanceBitrateControl({
  value,
  onChange,
}: {
  value: "High" | "Standard";
  onChange: (value: "High" | "Standard") => void;
}) {
  const BitrateIcon = () => (
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
            <span className="inline-flex items-center gap-1 rounded-md bg-[#d1fe17]/10 px-1.5 py-1 text-[#d1fe17]">
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
                      <Check className="size-4 text-[#d1fe17]" />
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

type MotionControlQuality = "720p" | "1080p";
type MotionControlRatio = "16:9" | "9:16" | "1:1";
type MotionControlResolution = "720p" | "1080p";

type MotionControlState = {
  motionVideoName: string;
  characterImageName: string;
  supportingAssets: string[];
  quality: MotionControlQuality;
  sceneControlEnabled: boolean;
  sceneSource: "video" | "image";
  advancedOpen: boolean;
  prompt: string;
  duration: number;
  aspectRatio: MotionControlRatio;
  resolution: MotionControlResolution;
};

const SHARED_KLING_MOTION_CAPABILITIES = {
  motionVideoAccept: "video/mp4,video/quicktime",
  characterImageAccept: "image/jpeg,image/jpg,image/png",
  supportingAssetAccept: "image/jpeg,image/jpg,image/png",
  maxSupportingAssets: 4,
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
  duration: { min: 3, max: 15, default: 8 },
  aspectRatios: ["16:9", "9:16", "1:1"] as MotionControlRatio[],
  resolutions: ["720p", "1080p"] as MotionControlResolution[],
} as const;

function createMotionControlState(): MotionControlState {
  return {
    motionVideoName: "",
    characterImageName: "",
    supportingAssets: [],
    quality: "720p",
    sceneControlEnabled: false,
    sceneSource: "video",
    advancedOpen: false,
    prompt: "",
    duration: SHARED_KLING_MOTION_CAPABILITIES.duration.default,
    aspectRatio: "16:9",
    resolution: "720p",
  };
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
  onOpenAssets,
  onOpenModelPanel,
}: {
  model: WorkflowModel;
  state: MotionControlState;
  onChange: (patch: Partial<MotionControlState>) => void;
  onOpenAssets: () => void;
  onOpenModelPanel: () => void;
}) {
  const advancedId = `motion-advanced-${model.id}`;

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
          className="absolute right-3 top-3 z-10 inline-flex h-6 items-center gap-1 rounded-lg border border-white/10 bg-black/70 px-2 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-black"
        >
          <BookOpen className="size-3.5" />
          How it works
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

      <ModelTrigger model={model} onClick={onOpenModelPanel} />

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

      <button
        type="button"
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

      <div
        id={advancedId}
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
            <div className="relative">
              <label className={`block rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 transition-opacity ${
                state.sceneControlEnabled ? "opacity-50 pointer-events-none select-none" : ""
              }`}>
                <span className="text-xs font-semibold text-zinc-300">
                  Prompt
                </span>
                <textarea
                  rows={5}
                  maxLength={2500}
                  disabled={state.sceneControlEnabled}
                  value={state.prompt}
                  onChange={(event) => onChange({ prompt: event.target.value })}
                  placeholder={'Describe background and scene details – e.g., "A corgi runs in" or "Snowy park setting". Motion is controlled by your reference video'}
                  className="mt-1 min-h-[100px] max-h-64 w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                />
              </label>

              {state.sceneControlEnabled && (
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="absolute inset-0 size-full cursor-pointer rounded-xl bg-transparent focus:outline-none"
                    />
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      side="right"
                      align="center"
                      sideOffset={12}
                      className="z-[100000] w-72 rounded-2xl border border-white/10 bg-[#191b1d]/95 p-4 shadow-2xl backdrop-blur-xl animate-popover-in-right"
                    >
                      <div className="rounded-xl border border-white/10 bg-[#131517] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">Scene control mode</span>
                          <span className="flex h-5 w-8 items-center rounded-full bg-emerald-500 p-0.5">
                            <span className="size-4 translate-x-3 rounded-full bg-white transition-transform" />
                          </span>
                        </div>
                        <div className="mt-2.5 flex rounded-lg border border-white/10 bg-black/40 p-1">
                          <span className="flex flex-1 items-center justify-center gap-1 py-1 text-[11px] font-semibold text-zinc-400">
                            <Video className="size-3" /> Video
                          </span>
                          <span className="flex flex-1 items-center justify-center gap-1 rounded bg-white/10 py-1 text-[11px] font-semibold text-white">
                            <ImageIcon className="size-3" /> Image
                          </span>
                        </div>
                        <p className="mt-2 text-[10px] text-zinc-400">
                          Choose where the background should come from: the character image or the motion video
                        </p>
                      </div>

                      <div className="mt-3">
                        <p className="text-xs font-semibold text-white">Scene control enabled</p>
                        <p className="mt-1 text-[11px] leading-4 text-zinc-400">
                          Advanced settings (Prompt + Orientation) are locked to keep the scene consistent.
                        </p>
                        <p className="mt-1.5 text-[11px] text-zinc-400">
                          To adjust these settings, turn Scene control mode off.
                        </p>

                        <div className="mt-3 flex gap-2">
                          <Popover.Close asChild>
                            <button
                              type="button"
                              onClick={() => onChange({ sceneControlEnabled: false })}
                              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700"
                            >
                              Turn off
                            </button>
                          </Popover.Close>
                          <Popover.Close asChild>
                            <button
                              type="button"
                              className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
                            >
                              Not now
                            </button>
                          </Popover.Close>
                        </div>
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              )}
            </div>

            <div className={`space-y-1.5 transition-opacity ${
              state.sceneControlEnabled ? "opacity-50 pointer-events-none" : ""
            }`}>
              <p className="text-xs font-semibold text-zinc-400">Orientation</p>
              <div className="flex rounded-xl border border-white/[0.07] bg-white/[0.035] p-1">
                <button
                  type="button"
                  disabled={state.sceneControlEnabled}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 py-1.5 text-xs font-semibold text-white"
                >
                  <Video className="size-3.5" /> Video
                </button>
                <button
                  type="button"
                  disabled={state.sceneControlEnabled}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
                >
                  <ImageIcon className="size-3.5" /> Image
                </button>
              </div>
              <p className="px-1 text-[11px] leading-4 text-zinc-500">
                When Character Orientation matches the video, complex motions perform better; when it matches the image, camera movements are better supported.
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenAssets}
              className="relative flex min-h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-3 text-center hover:border-[#D97757]/55 hover:bg-[#D97757]/[0.04]"
            >
              <span className="absolute right-2 top-2 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-zinc-500">
                Optional
              </span>
              <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-zinc-300">
                <Plus className="size-4" />
              </span>
              <span className="mt-2 text-xs font-semibold text-white">
                Upload images & elements
              </span>
              <span className="mt-1 text-[11px] text-zinc-500">
                {state.supportingAssets.length > 0
                  ? `${state.supportingAssets.length} of ${SHARED_KLING_MOTION_CAPABILITIES.maxSupportingAssets} selected`
                  : "Up to 4 images or elements"}
              </span>
            </button>

            <div className="grid grid-cols-3 gap-2">
              <SeedanceDurationControl
                value={state.duration}
                onChange={(duration) => onChange({ duration })}
                min={SHARED_KLING_MOTION_CAPABILITIES.duration.min}
                max={SHARED_KLING_MOTION_CAPABILITIES.duration.max}
                inputName={`standalone-${model.id}-duration`}
              />
              <SeedanceSelectControl
                label="Aspect ratio"
                value={state.aspectRatio}
                options={SHARED_KLING_MOTION_CAPABILITIES.aspectRatios}
                icon={RectangleHorizontal}
                onChange={(aspectRatio) =>
                  onChange({ aspectRatio: aspectRatio as MotionControlRatio })
                }
              />
              <SeedanceSelectControl
                label="Resolution"
                value={state.resolution}
                options={SHARED_KLING_MOTION_CAPABILITIES.resolutions}
                icon={Diamond}
                onChange={(resolution) =>
                  onChange({ resolution: resolution as MotionControlResolution })
                }
              />
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
}

export default function StandaloneVideoCreationPanel({
  workflow,
  onWorkflowChange,
}: StandaloneVideoCreationPanelProps) {
  const searchParams = useSearchParams();
  const [modelIndexes, setModelIndexes] = useState(DEFAULT_MODEL_INDEX);
  const [modelOpen, setModelOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5s");
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [autoSettings, setAutoSettings] = useState(true);
  const [omniEditVideoName, setOmniEditVideoName] = useState("");
  const [omniEditSupportingName, setOmniEditSupportingName] = useState("");
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
  const [kling3MultiShot, setKling3MultiShot] = useState(true);
  const [kling3MultiShotMode, setKling3MultiShotMode] = useState("Auto");
  const [kling3Enhance, setKling3Enhance] = useState(true);
  const [kling3Sound, setKling3Sound] = useState(true);
  const [kling3ElementsOpen, setKling3ElementsOpen] = useState(false);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [, setElementReferences] = useState<string[]>([]);
  const [geminiInputMode, setGeminiInputMode] = useState<
    "elements" | "frames"
  >("elements");
  const [geminiElementsMedia, setGeminiElementsMedia] = useState("");
  const [geminiStartFrame, setGeminiStartFrame] = useState("");
  const [geminiEndFrame, setGeminiEndFrame] = useState("");
  const [geminiDuration, setGeminiDuration] = useState(10);
  const [geminiAspectRatio, setGeminiAspectRatio] = useState("9:16");
  const [geminiPickerTarget, setGeminiPickerTarget] = useState<
    "elements" | "startFrame" | "endFrame" | null
  >(null);
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
  const [motionAssetsTarget, setMotionAssetsTarget] = useState<string | null>(
    null,
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
  const motionState =
    workflow === "motion-control"
      ? motionStates[selectedModel.id] ?? createMotionControlState()
      : null;

  const openModelPanel = () => {
    setModelOpen(true);
  };

  useEffect(() => {
    const requestedModel = searchParams.get("model");
    if (!requestedModel) return;

    const target = NAVBAR_MODEL_TARGETS[requestedModel];
    if (!target) return;

    const targetModels = WORKFLOW_MODELS[target.workflow];
    const targetIndex = targetModels.findIndex(
      (model) => model.name === target.modelName,
    );
    if (targetIndex < 0) return;
    if (
      targetModels[targetIndex].disabled ||
      targetModels[targetIndex].available === false
    )
      return;

    onWorkflowChange(target.workflow);
    setModelIndexes((current) => ({
      ...current,
      [target.workflow]: targetIndex,
    }));
    setModelOpen(false);
  }, [onWorkflowChange, searchParams]);

  const changeWorkflow = (nextWorkflow: StandaloneVideoWorkflow) => {
    onWorkflowChange(nextWorkflow);
    setModelOpen(false);
  };

  const selectModel = (index: number) => {
    const nextModel = models[index];
    if (!nextModel || nextModel.disabled || nextModel.available === false)
      return;
    setModelIndexes((current) => ({ ...current, [workflow]: index }));
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
    <div className="relative z-20 w-full shrink-0 lg:h-full lg:w-[350px]">
      <aside className="flex min-h-[650px] w-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#17191b] lg:h-full">
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {seedanceCapabilities ? (
            <SeedanceBanner modelName={selectedModel.name} />
          ) : geminiCapabilities || happyHorseCapabilities || grokCapabilities || klingCapabilities ? null : (
            <WorkflowBanner workflow={workflow} model={selectedModel} />
          )}

          {workflow === "create-video" && (
            <>
              {seedanceCapabilities ? (
                <>
                  <SeedanceMediaUpload
                    fileName={seedanceMediaName}
                    onFileNameChange={setSeedanceMediaName}
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
                  <GeminiInputModeSwitch
                    value={geminiInputMode}
                    onChange={setGeminiInputMode}
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
                    />
                  )}
                  <ModelTrigger
                    model={selectedModel}
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
                        General
                      </p>
                      <p className="text-xs text-white/80">HappyHorse</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
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
                            <span className="cursor-pointer text-[#D97757] hover:underline">
                              generate it
                            </span>
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
                        General
                      </p>
                      <p className="text-xs text-white/80">{grokCapabilities.subtitle}</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
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
                            <span className="cursor-pointer text-[#D97757] hover:underline">
                              generate it
                            </span>
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
                        General
                      </p>
                      <p className="text-xs text-white/80">{klingCapabilities.subtitle}</p>
                    </figcaption>
                    <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1">
                      <button
                        type="button"
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

                  {/* Prompt area — raised dark surface for Kling 3.0, flat for Turbo */}
                  <div className={`relative flex min-h-[10rem] max-h-[16rem] flex-col overflow-hidden ${
                    klingCapabilities.surfaceStyle === "raised"
                      ? "rounded-t-xl border border-b-0 border-white/[0.07] bg-white/[0.035] md:bg-[#1c1e20]"
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

                  {/* Action row — Kling 3.0 only, attached under prompt */}
                  {klingCapabilities.actionRow && (
                    <div className="-mt-[1px] flex items-center gap-1.5 rounded-b-xl border border-t border-white/[0.07] bg-white/[0.035] md:bg-[#1c1e20] px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => setKling3Enhance((v) => !v)}
                        className={`inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium transition-colors ${
                          kling3Enhance
                            ? "bg-[#131517] text-white"
                            : "bg-[#131517] text-zinc-500"
                        }`}
                      >
                        <WandSparkles className="size-3.5" />
                        Enhance
                      </button>
                      <button
                        type="button"
                        onClick={() => setKling3Sound((v) => !v)}
                        className={`inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium transition-colors ${
                          kling3Sound
                            ? "bg-[#131517] text-white"
                            : "bg-[#131517] text-zinc-500"
                        }`}
                      >
                        {kling3Sound ? (
                          <Volume2 className="size-3.5" />
                        ) : (
                          <VolumeX className="size-3.5" />
                        )}
                        {kling3Sound ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setKling3ElementsOpen(true)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#131517] px-1.5 text-[12px] font-medium text-zinc-400 transition-colors hover:text-white"
                      >
                        <AtSign className="size-3.5" />
                        Elements
                      </button>
                    </div>
                  )}

                  <ModelTrigger
                    model={selectedModel}
                    onClick={openModelPanel}
                  />

                  <div className="flex gap-2">
                    <SeedanceDurationControl
                      value={klingDurationNum}
                      onChange={setKlingDurationNum}
                      min={klingCapabilities.durationSlider.min}
                      max={klingCapabilities.durationSlider.max}
                      inputName="standalone-kling-duration"
                    />
                    <SeedanceSelectControl
                      label="Aspect ratio"
                      value={klingAspectRatio}
                      options={klingCapabilities.aspectRatioOptions}
                      icon={RectangleHorizontal}
                      onChange={setKlingAspectRatio}
                    />
                    <SeedanceSelectControl
                      label="Resolution"
                      value={klingResolution}
                      options={klingCapabilities.resolutionOptions}
                      icon={Diamond}
                      onChange={setKlingResolution}
                    />
                  </div>
                </>
              ) : (
                <>
                  <UploadSurface
                    title="Upload image or generate it"
                    description="PNG, JPG or Paste from clipboard"
                    icon={ImagePlus}
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

          {workflow === "edit-video" && (
            <>
              <UploadSurface
                title="Upload a video to edit"
                description="Duration required: 3-10 secs"
                icon={Video}
                accept="video/mp4,video/quicktime"
                fileName={
                  selectedModel.panel === "omni-edit"
                    ? omniEditVideoName
                    : undefined
                }
                onFileNameChange={
                  selectedModel.panel === "omni-edit"
                    ? setOmniEditVideoName
                    : undefined
                }
              />
              <UploadSurface
                title="Upload images & elements"
                description="Up to 4 images or elements"
                icon={Plus}
                accept="image/jpeg,image/jpg,image/png"
                fileName={
                  selectedModel.panel === "omni-edit"
                    ? omniEditSupportingName
                    : undefined
                }
                onFileNameChange={
                  selectedModel.panel === "omni-edit"
                    ? setOmniEditSupportingName
                    : undefined
                }
              />
              <label className="block rounded-xl bg-white/[0.035] p-3">
                <span className="text-xs font-semibold text-zinc-300">
                  Prompt
                </span>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder='Describe the change you want, like "Make it snow".'
                  className="mt-1 w-full resize-none bg-transparent text-sm leading-5 text-white outline-none placeholder:text-zinc-500"
                />
              </label>
              <button
                type="button"
                onClick={() => setAutoSettings((value) => !value)}
                className="flex h-12 w-full items-center justify-between rounded-xl bg-white/[0.035] px-3 text-sm font-semibold text-white"
              >
                Auto settings
                <span
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${
                    autoSettings ? "bg-[#D97757]" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`size-5 rounded-full bg-white transition-transform ${
                      autoSettings ? "translate-x-4" : ""
                    }`}
                  />
                </span>
              </button>
              <ModelTrigger
                model={selectedModel}
                onClick={openModelPanel}
              />
              <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 text-xs font-semibold text-white">
                <Diamond className="size-4" />
                720p
              </span>
            </>
          )}

          {workflow === "motion-control" && motionState && (
            <KlingMotionControlForm
              model={selectedModel}
              state={motionState}
              onChange={(patch) => updateMotionState(selectedModel.id, patch)}
              onOpenAssets={() => setMotionAssetsTarget(selectedModel.id)}
              onOpenModelPanel={openModelPanel}
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
            {generating
              ? "GENERATING"
              : grokCapabilities
                ? `Generate  ✦ ${grokCapabilities.credits}`
                : klingCapabilities
                  ? `Generate  ✦ ${klingCapabilities.credits}`
                  : workflow === "edit-video"
                    ? "Generate  ✦ 9"
                    : workflow === "motion-control"
                      ? `Generate  ✦ ${motionState?.sceneControlEnabled ? 10 : 8}`
                      : "Generate  ✦ 7.5"}
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
      <AssetsPickerModal
        isOpen={assetsPickerOpen}
        onClose={() => setAssetsPickerOpen(false)}
        defaultTab="elements"
        accept="image/*,video/*,audio/*"
        onSelectAsset={(url) =>
          setElementReferences((current) => [...current, url])
        }
      />
      <AssetsPickerModal
        isOpen={geminiPickerTarget !== null}
        onClose={() => setGeminiPickerTarget(null)}
        defaultTab="uploads"
        mode={
          geminiPickerTarget === "startFrame"
            ? "startFrame"
            : geminiPickerTarget === "endFrame"
              ? "endFrame"
              : "default"
        }
        accept={
          geminiPickerTarget === "elements"
            ? "image/*,video/*"
            : "image/*"
        }
        variant="geminiOmniFlash"
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
      <AssetsPickerModal
        isOpen={motionAssetsTarget !== null}
        onClose={() => setMotionAssetsTarget(null)}
        defaultTab="uploads"
        accept={SHARED_KLING_MOTION_CAPABILITIES.supportingAssetAccept}
        onSelectAsset={(url) => {
          if (!motionAssetsTarget) return;
          const current =
            motionStates[motionAssetsTarget] ?? createMotionControlState();
          if (
            current.supportingAssets.length >=
            SHARED_KLING_MOTION_CAPABILITIES.maxSupportingAssets
          )
            return;
          updateMotionState(motionAssetsTarget, {
            supportingAssets: [...current.supportingAssets, url],
          });
        }}
      />
      <AssetsPickerModal
        isOpen={kling3ElementsOpen}
        onClose={() => setKling3ElementsOpen(false)}
        defaultTab="elements"
        accept="image/*,video/*"
        onSelectAsset={(url) =>
          setElementReferences((current) => [...current, url])
        }
      />
    </div>
  );
}

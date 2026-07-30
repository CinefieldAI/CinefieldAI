"use client";

import {
  AtSign,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Diamond,
  Film,
  ImageIcon,
  ImagePlus,
  Loader2,
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
  name: string;
  description: string;
  icon: ElementType;
  badge?: "NEW" | "EXCLUSIVE";
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
    name: "Seedance 2.0",
    description: "Native cinematic video generation",
    icon: SeedanceIcon,
    quality: "4K",
    duration: "4s-15s",
  },
  {
    name: "Seedance 2.0 Mini",
    description: "Fast compact Seedance generation",
    icon: SeedanceIcon,
    badge: "NEW",
    quality: "720p",
    duration: "4s-15s",
  },
  {
    name: "Seedance 2.0 Fast",
    description: "Speed-optimized video generation",
    icon: SeedanceIcon,
    quality: "720p",
    duration: "4s-15s",
  },
  {
    name: "Gemini Omni Flash",
    description: "Google multimodal video generation",
    icon: GoogleIcon,
    badge: "NEW",
    quality: "720p",
    duration: "4s-10s",
  },
  {
    name: "Cinematic Studio Video 3.5",
    description: "Director-grade cinematic controls",
    icon: WandSparkles,
    badge: "NEW",
    quality: "1080p",
    duration: "4s-15s",
  },
  {
    name: "Kling 3.0",
    description: "Cinematic videos with audio",
    icon: KlingIcon,
    quality: "4K",
    duration: "3s-15s",
    audio: true,
  },
  {
    name: "Kling 3.0 Turbo",
    description: "Faster generation with native audio",
    icon: KlingIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "3s-15s",
    audio: true,
  },
  {
    name: "Kling 3.0 Motion Control",
    description: "Transfer motion from video to image",
    icon: KlingIcon,
    quality: "1080p",
    duration: "3s-30s",
  },
  {
    name: "HappyHorse",
    description: "Fast stylized motion with audio",
    icon: HappyHorseIcon,
    badge: "NEW",
    quality: "1080p",
    duration: "3s-15s",
    audio: true,
  },
  {
    name: "Grok Imagine",
    description: "Expressive video generation",
    icon: GrokIcon,
    quality: "720p",
    duration: "1s-15s",
  },
  {
    name: "Sora 2",
    description: "OpenAI's most advanced video model",
    icon: OpenAISoraIcon,
    quality: "1080p",
    duration: "4s-12s",
  },
  {
    name: "Google Veo 3.1 Lite",
    description: "Fast video generation by Google",
    icon: GoogleIcon,
    quality: "720p",
    duration: "4s-8s",
  },
  {
    name: "Google Veo 3.1",
    description: "Advanced AI video with sound",
    icon: GoogleIcon,
    quality: "1080p",
    duration: "4s-8s",
    audio: true,
  },
  {
    name: "Wan 2.7",
    description: "AI video generation with frame control",
    icon: WanIcon,
    quality: "1080p",
    duration: "5s-10s",
  },
  {
    name: "Minimax Hailuo 2.3",
    description: "Fastest high-dynamic video",
    icon: MinimaxIcon,
    quality: "1080p",
    duration: "6s-10s",
  },
  {
    name: "Seedance 1.5 Pro",
    description: "Pro-grade audio-visual sync",
    icon: SeedanceIcon,
    quality: "1080p",
    duration: "4s-12s",
    audio: true,
  },
  {
    name: "Higgsfield DOP",
    description: "VFX and camera control",
    icon: Clapperboard,
    quality: "1080p",
    duration: "3s-10s",
  },
];

const EDIT_MODELS: WorkflowModel[] = [
  {
    name: "Gemini Omni Flash",
    description: "Edit videos with images and prompts",
    icon: GoogleIcon,
    badge: "NEW",
  },
  {
    name: "Higgsfield Reframe",
    description: "Reframe and resize videos to any aspect ratio",
    icon: WandSparkles,
  },
  {
    name: "Kling 3.0 Omni Edit",
    description: "Edit videos with text prompts",
    icon: KlingIcon,
    badge: "EXCLUSIVE",
  },
  {
    name: "Kling O1 Video Edit",
    description: "Generate with elements and references",
    icon: KlingIcon,
  },
  {
    name: "Kling Motion Control",
    description: "Control motion with video references",
    icon: KlingIcon,
  },
  {
    name: "Kling 3.0 Motion Control",
    description: "Transfer motion from video to image",
    icon: KlingIcon,
  },
  {
    name: "Grok Imagine Edit",
    description: "Edit videos with text prompts",
    icon: GrokIcon,
  },
];

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
  { name: "Minimax Hailuo 2.3 Fast", description: "Fast Hailuo generation", icon: MinimaxIcon, quality: "1080p", duration: "6s-10s" },
  { name: "Minimax Hailuo 02 Fast", description: "Efficient Hailuo generation", icon: MinimaxIcon, quality: "512p", duration: "6s-10s" },
  { name: "Minimax Hailuo 02", description: "High-quality Hailuo generation", icon: MinimaxIcon, quality: "1080p", duration: "6s-10s" },
  { name: "Kling 3.0 Omni", description: "Omni video generation", icon: KlingIcon, quality: "4K", duration: "3s-15s", audio: true },
  { name: "Kling 3.0 Omni Edit", description: "Omni video editing", icon: KlingIcon, quality: "1080p", duration: "3s-10s" },
  { name: "Kling 2.6", description: "Kling video generation", icon: KlingIcon, quality: "1080p", duration: "5s-10s", audio: true },
  { name: "Kling O1 Video", description: "Kling O1 video generation", icon: KlingIcon, quality: "1080p", duration: "5s-10s" },
  { name: "Kling O1 Video Edit", description: "Kling O1 video editing", icon: KlingIcon, quality: "1080p", duration: "3s-10s" },
  { name: "Kling Motion Control", description: "Control motion with references", icon: KlingIcon },
  { name: "Sora 2 Pro", description: "Professional Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { name: "Sora 2 Max", description: "Maximum-quality Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { name: "Sora 2 Pro Max", description: "Premium Sora generation", icon: OpenAISoraIcon, quality: "1080p", duration: "4s-12s", audio: true },
  { name: "Google Veo 3.1 Fast", description: "Fast Veo 3.1 generation", icon: GoogleIcon, quality: "1080p", duration: "4s-8s", audio: true },
  { name: "Google Veo 3 Fast", description: "Fast Veo 3 generation", icon: GoogleIcon, quality: "1080p", duration: "8s", audio: true },
  { name: "Google Veo 3", description: "Google video generation", icon: GoogleIcon, quality: "1080p", duration: "8s", audio: true },
  { name: "Higgsfield Lite", description: "Lightweight cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { name: "Higgsfield Standard", description: "Standard cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { name: "Higgsfield Turbo", description: "Fast cinematic generation", icon: Clapperboard, quality: "720p", duration: "3s-5s" },
  { name: "Wan 2.6", description: "Wan video generation", icon: WanIcon, quality: "1080p", duration: "5s-15s" },
  { name: "Wan 2.5", description: "Wan video generation", icon: WanIcon, quality: "1080p", duration: "5s-10s" },
  { name: "Wan 2.5 Fast", description: "Fast Wan generation", icon: WanIcon, quality: "1080p", duration: "5s-10s" },
  { name: "Wan 2.2", description: "Wan video generation", icon: WanIcon, quality: "720p", duration: "5s" },
  { name: "Wan 2.2 Fast", description: "Fast Wan generation", icon: WanIcon, quality: "720p", duration: "5s" },
  { name: "Seedance Pro", description: "Professional Seedance generation", icon: SeedanceIcon, quality: "1080p", duration: "5s-10s" },
  { name: "Seedance Pro Fast", description: "Fast professional Seedance generation", icon: SeedanceIcon, quality: "1080p", duration: "5s-10s" },
  { name: "Grok Imagine 1.5", description: "Expressive Grok generation", icon: GrokIcon, quality: "720p", duration: "1s-15s" },
  { name: "Grok Imagine Edit", description: "Edit videos with text prompts", icon: GrokIcon },
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
  "edit-video": 3,
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

const ASPECT_RATIO_OPTIONS = ["Auto", "16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
const RESOLUTION_OPTIONS = ["480p", "720p"];

const WORKFLOW_MODELS: Record<StandaloneVideoWorkflow, WorkflowModel[]> = {
  "create-video": CREATE_MODELS,
  "edit-video": EDIT_MODELS,
  "motion-control": EDIT_MODELS,
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
  "Grok Imagine 1.5": {
    workflow: "create-video",
    modelName: "Grok Imagine",
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
}: {
  title: string;
  description: string;
  compact?: boolean;
  icon?: LucideIcon;
}) {
  const [fileName, setFileName] = useState("");

  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-center transition-colors hover:border-[#D97757]/55 hover:bg-[#D97757]/[0.04] ${
        compact ? "min-h-44" : "min-h-32"
      }`}
    >
      <input
        type="file"
        className="sr-only"
        accept="image/*,video/*"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
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

function WorkflowBanner({ workflow }: { workflow: StandaloneVideoWorkflow }) {
  const content = {
    "create-video": {
      title: "GENERAL",
      subtitle: "Kling 3.0 Turbo",
      image: "https://static.higgsfield.ai/feed/step-3-thumbnail.webp",
    },
    "edit-video": {
      title: "KLING O1 EDIT",
      subtitle: "Modify, restyle, change angles, transform",
      image: "https://static.higgsfield.ai/feed/step2-thumbnail.webp",
    },
    "motion-control": {
      title: "MOTION CONTROL",
      subtitle: "Control motion with video references",
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
            const selected = index === selectedIndex;
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => onSelect(index)}
                onMouseEnter={() => setActiveGroupName(null)}
                aria-pressed={selected}
                className={`group/model flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                  selected
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
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[16px] font-semibold leading-5 text-white">
                      {model.name}
                    </span>
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
                {selected && (
                  <Check className="size-4 shrink-0 text-[#D97757]" />
                )}
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
                        if (expandable) {
                          showFlyout(event.currentTarget);
                        } else {
                          setActiveGroupName(null);
                        }
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
            const selected = index === selectedIndex;
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={selected}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                  selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[16px] font-semibold leading-5 text-white">
                    {model.name}
                  </span>
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
  const [sceneSource, setSceneSource] = useState<"video" | "image">("video");
  const [generating, setGenerating] = useState(false);
  const [seedanceMediaName, setSeedanceMediaName] = useState("");
  const [seedanceAudioEnabled, setSeedanceAudioEnabled] = useState(true);
  const [seedanceDuration, setSeedanceDuration] = useState(10);
  const [seedanceAspectRatio, setSeedanceAspectRatio] = useState("Auto");
  const [seedanceResolution, setSeedanceResolution] = useState("720p");
  const [seedanceBitrate, setSeedanceBitrate] = useState<
    "High" | "Standard"
  >("High");
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
    setPrompt("");
  };

  const selectModel = (index: number) => {
    setModelIndexes((current) => ({ ...current, [workflow]: index }));
    setModelOpen(false);
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
          ) : geminiCapabilities ? null : (
            <WorkflowBanner workflow={workflow} />
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
              />
              <UploadSurface
                title="Upload images & elements"
                description="Up to 4 images or elements"
                icon={Plus}
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

          {workflow === "motion-control" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <UploadSurface
                  title="Add motion to copy"
                  description="Video duration: 3-30 seconds"
                  compact
                  icon={Video}
                />
                <UploadSurface
                  title="Add your character"
                  description="Image with visible face and body"
                  compact
                  icon={Plus}
                />
              </div>
              <ModelTrigger
                model={selectedModel}
                onClick={openModelPanel}
              />
              <button
                type="button"
                className="flex h-12 w-full items-center justify-between rounded-xl bg-white/[0.035] px-3 text-left"
              >
                <span>
                  <span className="block text-[10px] text-zinc-500">Quality</span>
                  <span className="text-sm font-semibold text-white">720p</span>
                </span>
                <ChevronDown className="size-4 -rotate-90 text-zinc-500" />
              </button>
              <div className="rounded-xl bg-white/[0.035] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">
                    Scene control mode
                  </span>
                  <span className="flex h-6 w-10 items-center rounded-full bg-[#D97757] p-0.5">
                    <span className="size-5 translate-x-4 rounded-full bg-white" />
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 rounded-lg bg-black/20 p-1">
                  {(["video", "image"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSceneSource(value)}
                      className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold capitalize ${
                        sceneSource === value
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
                  Choose where the background should come from: the character
                  image or the motion video.
                </p>
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-between py-2 text-xs font-semibold text-white"
              >
                Advanced settings
                <ChevronDown className="size-4" />
              </button>
            </>
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
              : workflow === "edit-video"
                ? "Generate  ✦ 9"
                : workflow === "motion-control"
                  ? "Generate  ✦ 12"
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
    </div>
  );
}

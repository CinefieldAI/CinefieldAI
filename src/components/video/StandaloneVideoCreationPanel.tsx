"use client";

import {
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Diamond,
  Film,
  ImageIcon,
  ImagePlus,
  Loader2,
  Move3d,
  Plus,
  Search,
  Scissors,
  Sparkles,
  Upload,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { useSearchParams } from "next/navigation";
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

const CREATE_MODELS: WorkflowModel[] = [
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
  "create-video": 6,
  "edit-video": 3,
  "motion-control": 5,
};

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
  const filtered = useMemo(
    () =>
      models
        .map((model, index) => ({ model, index }))
        .filter(({ model }) =>
          model.name.toLowerCase().includes(search.toLowerCase()),
        ),
    [models, search],
  );

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
        className={`absolute left-[calc(100%+12px)] z-50 w-[390px] max-w-[calc(100vw-390px)] overflow-hidden rounded-2xl border border-white/10 bg-[#1d2022]/[0.98] shadow-2xl shadow-black/60 backdrop-blur-xl max-lg:left-0 max-lg:top-full max-lg:mt-2 max-lg:w-full max-lg:max-w-none ${panelTop}`}
      >
        <div className="flex h-12 items-center gap-2 border-b border-white/[0.07] px-3">
          <Search className="size-4 text-zinc-500" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>
        <div className="max-h-[600px] overflow-y-auto p-2">
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
                aria-pressed={selected}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                  selected
                    ? "bg-white/[0.07]"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] ${
                    selected ? "text-[#D97757]" : "text-zinc-400"
                  }`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-white">
                      {model.name}
                    </span>
                    {model.audio && (
                      <Video className="size-3 text-zinc-500" />
                    )}
                    {model.badge && (
                      <span className="rounded bg-[#D97757] px-1 py-0.5 text-[9px] font-black text-black">
                        {model.badge}
                      </span>
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
                    <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
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
        </div>
      </div>
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

export default function StandaloneVideoCreationPanel() {
  const searchParams = useSearchParams();
  const [workflow, setWorkflow] =
    useState<StandaloneVideoWorkflow>("create-video");
  const [modelIndexes, setModelIndexes] = useState(DEFAULT_MODEL_INDEX);
  const [modelOpen, setModelOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5s");
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [autoSettings, setAutoSettings] = useState(true);
  const [sceneSource, setSceneSource] = useState<"video" | "image">("video");
  const [generating, setGenerating] = useState(false);

  const models = WORKFLOW_MODELS[workflow];
  const selectedIndex = modelIndexes[workflow];
  const selectedModel = models[selectedIndex];

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

    setWorkflow(target.workflow);
    setModelIndexes((current) => ({
      ...current,
      [target.workflow]: targetIndex,
    }));
    setModelOpen(false);
  }, [searchParams]);

  const changeWorkflow = (nextWorkflow: StandaloneVideoWorkflow) => {
    setWorkflow(nextWorkflow);
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
          className="flex h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-white/[0.07] px-3 [scrollbar-width:none]"
        >
          {WORKFLOWS.map((item) => {
            const Icon = item.icon;
            const selected = workflow === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => changeWorkflow(item.value)}
                className={`relative flex h-12 shrink-0 items-center gap-1.5 px-1.5 text-xs font-semibold transition-colors ${
                  selected ? "text-white" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                <Icon className="size-3.5" />
                {item.label}
                {selected && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 bg-white" />
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <WorkflowBanner workflow={workflow} />

          {workflow === "create-video" && (
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
                onClick={() => setModelOpen((open) => !open)}
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
                onClick={() => setModelOpen((open) => !open)}
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
                onClick={() => setModelOpen((open) => !open)}
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
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#D97757] text-sm font-bold text-black shadow-[0_5px_0_#934c36] transition-transform active:translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
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
    </div>
  );
}

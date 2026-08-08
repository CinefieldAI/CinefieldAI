"use client";

import { useEffect, useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, MapPin, Palette, Plus, Search, Check, Wand2 } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";
import { IMAGE_MODEL_CONFIGS, type ImageModelConfig } from "@/lib/imageModelConfig";
import { useRouter, useSearchParams } from "next/navigation";
import Cinema25AssetsPicker from "@/components/cinema-studio/Cinema25AssetsPicker";
import ColorTransferPanel, { type ColorTransferSwatch } from "./ColorTransferPopover";
import CharacterCardPopover from "./CharacterCardPopover";
import SoulGeneralCard from "./SoulGeneralCard";
import AttachmentPreview from "@/components/landing/createImage/AttachmentPreview";
import type { ReferenceAttachment } from "@/components/landing/createImage/createImageData";
import { PROMPT_BAR_SURFACE } from "@/lib/promptBarChassis";
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
  MultiReferenceIcon,
} from "@/components/cinema-studio/icons/ProviderIcons";
import WanIcon from "@/components/cinema-studio/icons/WanIcon";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import {
  getCapabilities,
  type AspectRatioChoice,
} from "@/components/landing/createImage/imageModelCapabilities";

const DEFAULT_GENERATE_PROMPT_WIDTH = 960;
const MAX_GENERATE_PROMPT_WIDTH = 1100;
const DEFAULT_GENERATE_PROMPT_HEIGHT = 116;
const MAX_GENERATE_PROMPT_HEIGHT = 360;
const GENERATE_VIEWPORT_GUTTER = 16;
import {
  AspectRatioPopover,
  AssetsButtonGroup,
  BatchSizeCounter,
  EnhancementToggle,
  LabeledToggle,
  QualityPopover,
  ResolutionPopover,
  SettingsPopover,
  type FluxFlexSettings,
} from "@/components/landing/createImage/ModelCapabilityControls";

const MODEL_ICONS: Record<string, string> = {
  seedream: "•",
};

/** Active-state color for the currently selected provider/model — applied
 *  to the icon, its container border/tint/glow, and the trigger button. */
const SELECTED_ACTIVE = "#D97757";

/** Exact supplied brand SVGs, one per provider — never a letter/emoji
 *  substitute, never a third-party icon set. */
const PROVIDER_ICONS: Record<
  string,
  React.ForwardRefExoticComponent<React.SVGProps<SVGSVGElement>>
> = {
  google: GoogleIcon,
  grok: GrokIcon,
  openai: OpenAIIcon,
  sora: OpenAISoraIcon,
  seedance: SeedanceIcon,
  seedream: SeedreamIcon,
  kling: KlingIcon,
  recraft: RecraftIcon,
  flux: FluxIcon,
  "multi-reference": MultiReferenceIcon,
  wan: WanIcon,
};

/** Renders a model's selector icon — the exact supplied brand SVG for
 *  every provider in PROVIDER_ICONS, a real lucide icon for Cinematic
 *  Locations' lime pin, falling back to the plain glyph avatar only for
 *  models that don't yet have a distinct brand icon (Seedream). */
function ModelIcon({
  icon,
  className,
  active,
}: {
  icon: string;
  className?: string;
  active?: boolean;
}) {
  if (icon === "pin") {
    return (
      <MapPin
        className={className}
        style={active ? { color: SELECTED_ACTIVE } : undefined}
      />
    );
  }
  const Provider = PROVIDER_ICONS[icon];
  if (Provider) {
    return (
      <Provider
        className={className}
        aria-hidden="true"
        style={active ? { color: SELECTED_ACTIVE } : undefined}
      />
    );
  }
  return (
    <span className={className} style={active ? { color: SELECTED_ACTIVE } : undefined}>
      {MODEL_ICONS[icon as keyof typeof MODEL_ICONS] || "•"}
    </span>
  );
}

const PILL = "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none";

/** Width/height pairs for every ratio string used across IMAGE_MODEL_CONFIGS,
 *  reusing the same icon-drawing convention as the createImage capability
 *  system's AspectRatioChoice. */
const RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  Auto: { width: 16, height: 16 },
  "1:1": { width: 16, height: 16 },
  "3:4": { width: 15, height: 20 },
  "4:3": { width: 20, height: 15 },
  "9:16": { width: 12, height: 21 },
  "16:9": { width: 21, height: 12 },
  "2:3": { width: 14, height: 21 },
  "3:2": { width: 21, height: 14 },
  "5:4": { width: 20, height: 16 },
  "4:5": { width: 16, height: 20 },
  "21:9": { width: 24, height: 10 },
};

function toRatioChoices(values: string[]): AspectRatioChoice[] {
  return values.map((value) => ({
    value,
    ...(RATIO_DIMENSIONS[value] ?? { width: 16, height: 16 }),
  }));
}

type ModelListItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  badge?: string;
};

const FEATURED_MODELS_LIST: ModelListItem[] = [
  { id: "cinematic-locations", label: "Cinematic Locations", description: "Rich environments with cinematic lighting", icon: "pin" },
  { id: "higgsfield-soul-2", label: "🚫 Cinefield Soul 2.0", description: "Next generation ultra-realistic fashion visuals", icon: "google" },
  { id: "higgsfield-soul-cinema", label: "🚫 Cinefield Soul Cinema", description: "Cinema-grade visual creation", icon: "google" },
  { id: "gpt-image-2", label: "GPT Image 2", description: "4K images with near-perfect text rendering", icon: "openai" },
  { id: "seedream-5-pro", label: "Seedream 5.0 Pro", description: "Logically consistent images with intelligent visual reasoning", icon: "seedream" },
  { id: "seedream-4-5", label: "Seedream 4.5", description: "ByteDance's next-gen 4K image model", icon: "seedream" },
  { id: "nano-banana-pro", label: "Nano Banana Pro", description: "Google's flagship generation model", icon: "google" },
  { id: "nano-banana-2", label: "Nano Banana 2", description: "Pro quality at Flash speed", icon: "google" },
  { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite", description: "Lightweight image generation at speed", icon: "google" },
  { id: "recraft-v4-1", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", icon: "recraft" },
];

const ALL_MODELS_LIST: ModelListItem[] = [
  { id: "auto", label: "Auto", description: "Automatically pick the best model for your prompt", icon: "google" },
  { id: "nano-banana", label: "Nano Banana", description: "Google's standard generation model", icon: "google" },
  { id: "higgsfield-soul", label: "🚫 Cinefield Soul", description: "Ultra-realistic fashion visuals", icon: "google" },
  { id: "higgsfield-face-swap", label: "🚫 Cinefield Face Swap", description: "Seamless face swapping", icon: "google" },
  { id: "higgsfield-character-swap", label: "🚫 Cinefield Character Swap", description: "Seamless character swapping", icon: "google" },
  { id: "seedream-4-0", label: "Seedream 4.0", description: "ByteDance's advanced image editing model", icon: "seedream" },
  { id: "gpt-image-1-5", label: "GPT Image 1.5", description: "True-color precision rendering", icon: "openai" },
  { id: "grok-imagine", label: "Grok Imagine", description: "Versatile image styles by xAI", icon: "grok" },
  { id: "recraft-v4-1-alt", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", icon: "recraft" },
  { id: "recraft-v4-1-utility", label: "Recraft V4.1 Utility", description: "Simple scenes with flat, even lighting", icon: "recraft" },
  { id: "z-image", label: "Z-Image", description: "Instant lifelike portraits", icon: "google" },
  { id: "kling-o1", label: "Kling O1", description: "Kling's Photorealistic Image Model", icon: "kling" },
  { id: "flux-2-pro", label: "FLUX.2 Pro", description: "Speed-optimized detail", icon: "flux" },
  { id: "flux-2-flex", label: "FLUX.2 Flex", description: "Next-gen image generation", icon: "flux" },
  { id: "flux-2-max", label: "FLUX.2 Max", description: "Ultimate precision and speed", icon: "flux" },
  { id: "flux-kontext-max", label: "Flux Kontext Max", description: "Edit with accuracy", icon: "flux" },
  { id: "gpt-image", label: "GPT Image", description: "Versatile text-to-image AI", icon: "openai" },
  { id: "multi-reference", label: "Multi Reference", description: "Multiple edits in one shot", icon: "multi-reference" },
  { id: "seedream-5-lite", label: "Seedream 5.0 Lite", description: "Intelligent visual reasoning", icon: "seedream" },
  { id: "seedream-4-5", label: "Seedream 4.5", description: "ByteDance's next-gen 4K image model", icon: "seedream" },
  { id: "wan-2-2", label: "WAN 2.2", description: "High-fidelity cinematic visuals", icon: "wan" },
];

interface ImageFormProps {
  isDrawOpen?: boolean;
  onDrawOpen?: (open: boolean) => void;
  /** Embeds ImageForm with an externally-controlled model (e.g. Cinema
   *  Studio's Image mode) instead of the page's own ?model= query param. */
  externalModel?: string;
  onExternalModelChange?: (id: string) => void;
  /** Renders as a normal flex-1 block instead of the page's own fixed
   *  bottom-of-viewport bar — used when embedding inside another layout
   *  (e.g. Cinema Studio's ModeToggle + composer row) that already
   *  positions the whole row itself. */
  embedded?: boolean;
}

/** The shared model-selector dropdown — same trigger, same Featured/All
 *  Models + search list, reused unchanged by every model (capability-driven
 *  and legacy alike) so there is exactly one selector implementation. */
function ModelSelectorDropdown({
  config,
  modelParam,
  isOpen,
  setIsOpen,
  modelSearch,
  setModelSearch,
  onSelect,
}: {
  config: ImageModelConfig;
  modelParam: string;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  modelSearch: string;
  setModelSearch: (v: string) => void;
  onSelect: (id: string) => void;
}) {
  const matches = (m: ModelListItem) =>
    m.label.toLowerCase().includes(modelSearch) ||
    m.description.toLowerCase().includes(modelSearch);

  /** Both sections flattened in render order so arrow keys walk the whole list. */
  const flatRows = [...FEATURED_MODELS_LIST.filter(matches), ...ALL_MODELS_LIST.filter(matches)];

  const nav = useListboxNav({
    count: flatRows.length,
    selectedIndex: flatRows.findIndex((m) => m.id === modelParam),
    open: isOpen,
    onSelect: (index) => {
      const model = flatRows[index];
      if (model) onSelect(model.id);
    },
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Search keeps focus on open; ArrowDown hands off into the list. */
  const handlePanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.target === searchInputRef.current) {
      if (event.key === "ArrowUp") return;
      if (event.key === " ") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        nav.moveTo(nav.activeIndex);
        return;
      }
    }
    nav.handleKeyDown(event);
  };

  // Running counter matching flatRows, advanced as each section renders.
  let rowIndex = -1;

  const renderList = (list: ModelListItem[]) =>
    list
      .filter(matches)
      .map((model) => {
        const isSelected = modelParam === model.id;
        rowIndex += 1;
        const optionProps = nav.getOptionProps(rowIndex);
        return (
          <button
            key={model.id}
            ref={optionProps.ref as React.Ref<HTMLButtonElement>}
            tabIndex={optionProps.tabIndex}
            onClick={() => onSelect(model.id)}
            role="option"
            aria-selected={isSelected}
            aria-label={model.label}
            className={`group/model w-full flex gap-0 items-center pl-1.5 py-1.5 pr-3 rounded-xl transition-colors cursor-pointer outline-none hover:bg-white/5 focus-visible:bg-white/5 text-start ${
              isSelected
                ? "bg-[rgba(217,119,87,0.10)] ring-1 ring-inset ring-[rgba(217,119,87,0.45)]"
                : nav.activeIndex === rowIndex
                  ? "bg-white/5"
                  : ""
            }`}
          >
            <div
              className={`size-10 rounded-lg flex items-center justify-center shrink-0 mr-2 text-[#8a8a8a] transition-[color,background-color,box-shadow,border-color] duration-150 group-hover/model:text-[#D97757] group-hover/model:bg-[rgba(217,119,87,0.10)] ${
                isSelected ? "text-[#D97757]" : ""
              }`}
              style={
                isSelected
                  ? {
                      background: "rgba(217,119,87,0.10)",
                      border: "1px solid rgba(217,119,87,0.45)",
                      boxShadow:
                        "inset 0px 2px 3px 0px rgba(255,255,255,0.03), 0 0 12px rgba(217,119,87,0.20)",
                    }
                  : {
                      background: "rgba(255,255,255,0.05)",
                      boxShadow: "inset 0px 2px 3px 0px rgba(255,255,255,0.03)",
                    }
              }
            >
              <ModelIcon icon={model.icon} className="size-4" active={isSelected} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-1 items-start">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold leading-5 text-white">
                  {model.label}
                </span>
                {model.badge && (
                  <span className="font-grotesk text-sm inline-block uppercase px-1 rounded-sm font-bold -skew-x-12 h-4 max-h-4 leading-4 flex items-center justify-center bg-amber-400 text-black">
                    {model.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-neutral-400">{model.description}</span>
            </div>
            {isSelected && (
              <div className="size-5 shrink-0 flex items-center justify-center">
                <Check className="size-4" style={{ color: "#D97757" }} />
              </div>
            )}
          </button>
        );
      });

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={PILL}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={`Model: ${config.label}`}
        >
          <span className="size-4 flex items-center justify-center text-xs">
            <ModelIcon icon={config.icon} className="size-4" active />
          </span>
          <span>{config.label}</span>
          <ChevronDown className="size-3 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={12}
          onKeyDown={handlePanelKeyDown}
          className="outline-none z-[100000] rounded-2xl shadow-none border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] flex flex-col p-0 overflow-hidden transition-all duration-200 ease-out origin-bottom data-[state=open]:animate-popover-smooth-in data-[state=closed]:animate-popover-smooth-out"
        >
          <div className="relative rounded-2xl flex flex-col overflow-hidden w-screen h-screen md:h-[602px] md:w-[402px]">
            <div
              style={{
                position: "absolute",
                top: 0,
                width: "100%",
                height: "37px",
                borderRadius: "317px",
                background: "rgba(139, 213, 244, 0.24)",
                filter: "blur(50px)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: "35%",
                width: "100%",
                height: "37px",
                borderRadius: "317px",
                background: "rgba(139, 213, 244, 0.24)",
                filter: "blur(50px)",
                pointerEvents: "none",
              }}
            />

            <label className="relative z-10 px-3 py-2 flex items-center gap-2 min-h-[41px] h-[41px] border-b border-white/10 cursor-text">
              <Search className="size-4 text-neutral-500" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value.toLowerCase())}
                className="text-sm flex-1 outline-none bg-transparent text-white placeholder-neutral-500"
              />
            </label>

            <div className="relative overflow-hidden min-h-0 flex flex-col flex-1">
              <div
                className="absolute z-10 pointer-events-none select-none top-0 left-0 w-full opacity-100 transition-opacity"
                style={{
                  height: "12px",
                  background: "linear-gradient(rgba(19, 21, 23, 0.898) 0%, rgba(19, 21, 23, 0) 100%)",
                }}
              />

              <div className="hide-scrollbar min-h-0 overflow-y-auto h-full">
                <div>
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-2">
                    <span className="text-xs font-medium text-neutral-500 flex-1">Featured models</span>
                  </div>
                  <div className="px-3 flex flex-col gap-1">{renderList(FEATURED_MODELS_LIST)}</div>
                </div>

                <div className="mt-2">
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-2">
                    <span className="text-xs font-medium text-neutral-500 flex-1">All models</span>
                  </div>
                  <div className="px-3 flex flex-col gap-1 pb-4">{renderList(ALL_MODELS_LIST)}</div>
                </div>
              </div>

              <div
                className="absolute pointer-events-none select-none bottom-0 left-0 w-full opacity-100 transition-opacity"
                style={{
                  height: "12px",
                  background: "linear-gradient(rgba(19, 21, 23, 0) 0%, rgba(19, 21, 23, 0.898) 100%)",
                }}
              />
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function ImageForm({
  onDrawOpen,
  externalModel,
  onExternalModelChange,
  embedded,
}: ImageFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // When embedded (e.g. inside Cinema Studio's Image mode), the model is
  // controlled externally so selecting one never navigates away from the
  // host page — otherwise this falls back to the page's own ?model= param.
  const modelParam = externalModel ?? searchParams.get("model") ?? "nano-banana-pro";
  const config = IMAGE_MODEL_CONFIGS[modelParam];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const [, setPrompt] = useState("");
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [promptWidth, setPromptWidth] = useState(DEFAULT_GENERATE_PROMPT_WIDTH);
  const [promptHeight, setPromptHeight] = useState(DEFAULT_GENERATE_PROMPT_HEIGHT);
  const [maxPromptWidth, setMaxPromptWidth] = useState(MAX_GENERATE_PROMPT_WIDTH);
  const [maxPromptHeight, setMaxPromptHeight] = useState(MAX_GENERATE_PROMPT_HEIGHT);

  const [quality, setQuality] = useState(config?.defaultQuality ?? "");
  const [aspectRatio, setAspectRatio] = useState(config?.defaultAspectRatio ?? "Auto");
  const [count, setCount] = useState(config?.defaultCount ?? 1);

  // Capability-driven state — mirrors /image/create's PromptComposer.tsx so
  // GPT Image 2 / Higgsfield Soul Cinema / WAN 2.2 / Multi Reference / Flux
  // Kontext Max / FLUX.2 Max / FLUX.2 Pro / FLUX.2 Flex behave identically on
  // this page. Kept separate from the legacy state above.
  const capabilities = getCapabilities(config?.label ?? "");
  const [gptQuality, setGptQuality] = useState("High");
  const [modelQuality, setModelQuality] = useState(capabilities?.defaultQuality ?? "Pro");
  const [modelResolution, setModelResolution] = useState(capabilities?.defaultResolution ?? "2K");
  const [modelAspectRatio, setModelAspectRatio] = useState(capabilities?.defaultAspectRatio ?? "16:9");
  const [modelBatch, setModelBatch] = useState(capabilities?.defaultBatchSize ?? 1);
  const [enhancementEnabled, setEnhancementEnabled] = useState(capabilities?.defaultEnhancement ?? true);
  const [vectorMode, setVectorMode] = useState(capabilities?.defaultVectorMode ?? false);
  const [colorTransferOpen, setColorTransferOpen] = useState(false);
  // Higgsfield Soul 2.0 only — General style selection, local state until a
  // real preset backend exists.
  const [soulGeneralSelected, setSoulGeneralSelected] = useState(false);
  // Keyed by model id so Cinematic Locations' Color Transfer selection never
  // overwrites Recraft V4.1 / Recraft V4.1 Utility's (and vice versa) even
  // though all three share the exact same ColorTransferPanel component.
  const [colorTransferByModel, setColorTransferByModel] = useState<
    Record<string, { swatches: ColorTransferSwatch[]; selectedId: string | null }>
  >({});
  const colorTransferState = colorTransferByModel[modelParam] ?? { swatches: [], selectedId: null };
  const colorTransferSwatches = colorTransferState.swatches;
  const colorTransferSelectedId = colorTransferState.selectedId;
  const colorTransfer = colorTransferSelectedId !== null;
  const updateColorTransferForModel = (
    updates: Partial<{ swatches: ColorTransferSwatch[]; selectedId: string | null }>,
  ) => {
    setColorTransferByModel((prev) => ({
      ...prev,
      [modelParam]: { ...(prev[modelParam] ?? { swatches: [], selectedId: null }), ...updates },
    }));
  };
  const [fluxFlexSettings, setFluxFlexSettings] = useState<FluxFlexSettings>({
    strength: 50,
    guidance: 50,
  });
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  // Which tab the shared Assets Picker opens on: the plus button always
  // wants Uploads, the @ element-reference button wants Elements.
  const [assetsPickerElementsMode, setAssetsPickerElementsMode] = useState(false);
  const openUploadsPicker = () => {
    setAssetsPickerElementsMode(false);
    setAssetsPickerOpen(true);
  };
  const openElementsPicker = () => {
    setAssetsPickerElementsMode(true);
    setAssetsPickerOpen(true);
  };
  const [attachments, setAttachments] = useState<ReferenceAttachment[]>([]);
  // Element references are a distinct reference type from uploaded/generated
  // image attachments, kept per-model so Seedream 4.5 and Seedream 5.0 Lite
  // never share or overwrite each other's selections.
  const [elementReferencesByModel, setElementReferencesByModel] = useState<
    Record<string, ReferenceAttachment[]>
  >({});
  const elementReferences = elementReferencesByModel[modelParam] ?? [];

  // Reset per-model defaults whenever the model changes (route param) so no
  // stale control values leak between models — same pattern as PromptComposer.
  const [prevModelForReset, setPrevModelForReset] = useState(modelParam);
  if (modelParam !== prevModelForReset) {
    setPrevModelForReset(modelParam);
    if (capabilities) {
      setModelQuality(capabilities.defaultQuality ?? "Pro");
      setModelResolution(capabilities.defaultResolution ?? "2K");
      setModelAspectRatio(capabilities.defaultAspectRatio ?? "16:9");
      setModelBatch(capabilities.defaultBatchSize ?? 1);
      setEnhancementEnabled(capabilities.defaultEnhancement ?? true);
      setVectorMode(capabilities.defaultVectorMode ?? false);
    }
    setOpenPopoverId(null);
  }

  useEffect(() => {
    if (!embedded) return;

    const updateResizeBounds = () => {
      const left = composerRef.current?.getBoundingClientRect().left ?? GENERATE_VIEWPORT_GUTTER;
      setMaxPromptWidth(
        Math.max(
          320,
          Math.min(
            MAX_GENERATE_PROMPT_WIDTH,
            window.innerWidth - left - GENERATE_VIEWPORT_GUTTER,
          ),
        ),
      );
      setMaxPromptHeight(
        Math.max(
          DEFAULT_GENERATE_PROMPT_HEIGHT,
          Math.min(MAX_GENERATE_PROMPT_HEIGHT, window.innerHeight - 160),
        ),
      );
    };

    const frame = requestAnimationFrame(updateResizeBounds);
    window.addEventListener("resize", updateResizeBounds);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateResizeBounds);
    };
  }, [embedded]);

  const promptResize = usePromptSurfaceResize({
    width: promptWidth,
    height: promptHeight,
    minWidth: Math.min(DEFAULT_GENERATE_PROMPT_WIDTH, maxPromptWidth),
    maxWidth: maxPromptWidth,
    minHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
    maxHeight: maxPromptHeight,
    defaultWidth: DEFAULT_GENERATE_PROMPT_WIDTH,
    defaultHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
    setWidth: setPromptWidth,
    setHeight: setPromptHeight,
    storageKey: embedded ? "generatePromptDimensions" : undefined,
  });

  if (!config) return null;

  const handleModelSelect = (modelId: string) => {
    const newConfig = IMAGE_MODEL_CONFIGS[modelId];
    if (newConfig) {
      setQuality(newConfig.defaultQuality);
      setAspectRatio(newConfig.defaultAspectRatio);
      setCount(newConfig.defaultCount);
    } else {
      setQuality("");
      setAspectRatio("Auto");
      setCount(1);
    }
    setIsModelOpen(false);
    if (onExternalModelChange) {
      onExternalModelChange(modelId);
    } else {
      router.push(`/generate/image?model=${modelId}`);
    }
  };

  const attachmentCounter = attachments.length;
  const addAssetFromPicker = (url: string) => {
    setAttachments((prev) => [
      ...prev,
      { id: `att-${attachmentCounter + 1}`, url, name: "Selected asset", loading: false },
    ]);
  };
  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const addElementFromPicker = (url: string) => {
    setElementReferencesByModel((prev) => {
      const existing = prev[modelParam] ?? [];
      return {
        ...prev,
        [modelParam]: [
          ...existing,
          { id: `element-${existing.length + 1}`, url, name: "Selected element", loading: false },
        ],
      };
    });
  };
  const removeElementReference = (id: string) => {
    setElementReferencesByModel((prev) => {
      const existing = prev[modelParam] ?? [];
      const found = existing.find((a) => a.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return { ...prev, [modelParam]: existing.filter((a) => a.id !== id) };
    });
  };

  return (
    <div
      ref={composerRef}
      className={
        embedded
          ? `relative min-h-[116px] min-w-0 flex-none ${
              promptResize.isResizing
                ? ""
                : "transition-[width,height] duration-150 ease-out"
            }`
          : "fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-7xl px-4 z-50"
      }
      style={
        embedded
          ? { width: promptWidth, height: DEFAULT_GENERATE_PROMPT_HEIGHT }
          : undefined
      }
    >
      {/* Recraft V4.1 Utility — single decorative centered utility shell,
          purely visual (pointer-events-none), never duplicated. */}
      {modelParam === "recraft-v4-1-utility" && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-0.5 z-10 transition-opacity duration-200"
          style={{
            borderRadius: "20px",
            left: "calc(50% + 38px)",
            right: "auto",
            maxWidth: "calc(100% - 76px)",
            width: "800px",
            transform: "translateX(-50%)",
          }}
        >
          <div
            className="absolute left-0 right-0 overflow-hidden"
            style={{
              bottom: "calc(100% - 30px)",
              borderTopLeftRadius: "20px",
              borderTopRightRadius: "20px",
              background: "linear-gradient(180deg, rgba(209,254,23,0.08), rgba(209,254,23,0))",
            }}
          />
        </div>
      )}

      <div
        className={`flex min-w-0 items-stretch rounded-[24px] p-1 ${
          embedded ? "absolute inset-x-0 bottom-0" : "flex-1"
        }`}
        style={{
          minHeight: DEFAULT_GENERATE_PROMPT_HEIGHT,
          height: embedded ? promptHeight : DEFAULT_GENERATE_PROMPT_HEIGHT,
          background: "#141414",
          border: "1px solid rgba(255,255,255,0.025)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025), 0 12px 26px rgba(0,0,0,0.45)",
        }}
      >
        {/* Gray prompt surface — matches Higgsfield's chassis(flat, thin)
            → surface(gradient) nesting; the flat outer frame above is the
            near-black chassis, this is the lighter surface inside it. */}
        <div
          className="relative flex min-w-0 flex-1 items-stretch gap-3 rounded-[20px] p-3"
          style={PROMPT_BAR_SURFACE}
        >
        {embedded && (
          <PromptResizeHandles
            verticalHandleProps={promptResize.verticalHandleProps}
            cornerHandleProps={promptResize.cornerHandleProps}
            isResizing={promptResize.isResizing}
            verticalLabel="Resize generate image prompt height"
            cornerLabel="Resize generate image prompt width and height"
          />
        )}
        {/* Prompt input + controls. The prompt text box is flex-1 (grows to
            match the Generate button's height, per Higgsfield's real markup);
            the control row below it is mt-auto so it always stays pinned to
            the bottom regardless of how tall the input grows. */}
        <form className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Attachment preview */}
          {attachments.length > 0 && (
            <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
          )}
          {elementReferences.length > 0 && (
            <AttachmentPreview attachments={elementReferences} onRemove={removeElementReference} />
          )}

          {/* Prompt row — flex-1 so it grows to match the Generate button's
              height (Higgsfield's real markup makes the textarea flex-1). */}
          <div className="flex flex-1 gap-2 min-w-0">
            {!capabilities && config.showUpload && (
              <button
                type="button"
                onClick={openUploadsPicker}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-card shrink-0 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none"
              >
                <Plus className="size-3.5" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div
                ref={promptRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Prompt"
                data-placeholder="Describe the scene you imagine"
                onInput={(e) => setPrompt(e.currentTarget.textContent ?? "")}
                className="min-h-[24px] overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
              />
            </div>
          </div>

          {/* Controls row — mt-auto keeps it pinned to the bottom while the
              flex-1 prompt row above grows to fill the available height. */}
          {capabilities ? (
            <div className="mt-auto flex h-7 min-w-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {config.label === "Cinematic Locations" && (
                <>
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      detailed
                      lime
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter
                    value={modelBatch}
                    onChange={setModelBatch}
                    max={capabilities.maxBatchSize ?? 4}
                  />
                  <LabeledToggle
                    label="Color transfer"
                    enabled={colorTransfer}
                    onToggle={() => setColorTransferOpen(true)}
                    icon={<Palette className="h-3.5 w-3.5 opacity-60" />}
                    badge="New"
                    hideSwitch
                  />
                </>
              )}

              {config.label === "GPT Image 2" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      large
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <QualityPopover
                    value={gptQuality}
                    onChange={setGptQuality}
                    id="quality"
                    openId={openPopoverId}
                    onOpenIdChange={setOpenPopoverId}
                  />
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      detailed
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "🚫 Cinefield Soul Cinema" && (
                <>
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      compactWidth
                      lime
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {(config.label === "Multi Reference" ||
                config.label === "Flux Kontext Max" ||
                config.label === "FLUX.2 Max") && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  <EnhancementToggle
                    enabled={enhancementEnabled}
                    onToggle={() => setEnhancementEnabled((v) => !v)}
                  />
                </>
              )}

              {config.label === "FLUX.2 Pro" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      detailed
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "FLUX.2 Flex" && (
                <>
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  <SettingsPopover
                    settings={fluxFlexSettings}
                    onChange={setFluxFlexSettings}
                    id="settings"
                    openId={openPopoverId}
                    onOpenIdChange={setOpenPopoverId}
                  />
                </>
              )}

              {(config.label === "Recraft V4.1 Utility" || config.label === "Recraft V4.1") && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.qualityOptions && (
                    <QualityPopover
                      value={modelQuality}
                      onChange={setModelQuality}
                      options={capabilities.qualityOptions}
                      id="quality"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  <LabeledToggle label="Vector mode" enabled={vectorMode} onToggle={() => setVectorMode((v) => !v)} />
                  <LabeledToggle
                    label="Color transfer"
                    enabled={colorTransfer}
                    onToggle={() => setColorTransferOpen(true)}
                  />
                </>
              )}

              {config.label === "WAN 2.2" && (
                <>
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <EnhancementToggle
                    enabled={enhancementEnabled}
                    onToggle={() => setEnhancementEnabled((v) => !v)}
                    icon={<Wand2 className="h-4 w-4" style={{ color: enhancementEnabled ? SELECTED_ACTIVE : undefined }} />}
                  />
                </>
              )}

              {config.label === "🚫 Cinefield Soul 2.0" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} showElementButton={false} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  <EnhancementToggle
                    enabled={enhancementEnabled}
                    onToggle={() => setEnhancementEnabled((v) => !v)}
                    icon={<Wand2 className="h-4 w-4" style={{ color: enhancementEnabled ? SELECTED_ACTIVE : undefined }} />}
                  />
                  <LabeledToggle
                    label="Color transfer"
                    enabled={colorTransfer}
                    onToggle={() => setColorTransferOpen(true)}
                    icon={<Palette className="h-3.5 w-3.5 opacity-60" />}
                    badge="New"
                    hideSwitch
                  />
                </>
              )}

              {config.label === "Grok Imagine" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      compactWidth
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  {capabilities.qualityOptions && (
                    <QualityPopover
                      value={modelQuality}
                      onChange={setModelQuality}
                      options={capabilities.qualityOptions}
                      id="quality"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                </>
              )}

              {config.label === "Seedream 4.0" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup onOpenPicker={openUploadsPicker} showElementButton={false} />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.qualityOptions && (
                    <QualityPopover
                      value={modelQuality}
                      onChange={setModelQuality}
                      options={capabilities.qualityOptions}
                      id="quality"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "Seedream 4.5" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "Seedream 5.0 Lite" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      compactWidth
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "Seedream 5.0 Pro" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      detailed
                      label="QUALITY"
                      compactWidth
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {(config.label === "Nano Banana Pro" || config.label === "Nano Banana 2") && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  {capabilities.resolutionOptions && (
                    <ResolutionPopover
                      value={modelResolution}
                      onChange={setModelResolution}
                      options={capabilities.resolutionOptions}
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {config.label === "Nano Banana 2 Lite" && (
                <>
                  {capabilities.assetUpload && (
                    <AssetsButtonGroup
                      onOpenPicker={openUploadsPicker}
                      onOpenElementsPicker={openElementsPicker}
                    />
                  )}
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                  {capabilities.qualityOptions && (
                    <QualityPopover
                      value={modelQuality}
                      onChange={setModelQuality}
                      options={capabilities.qualityOptions}
                      id="quality"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                </>
              )}

              {config.label === "Z-Image" && (
                <>
                  <ModelSelectorDropdown
                    config={config}
                    modelParam={modelParam}
                    isOpen={isModelOpen}
                    setIsOpen={setIsModelOpen}
                    modelSearch={modelSearch}
                    setModelSearch={setModelSearch}
                    onSelect={handleModelSelect}
                  />
                  {capabilities.aspectRatioOptions && (
                    <AspectRatioPopover
                      value={modelAspectRatio}
                      onChange={setModelAspectRatio}
                      options={capabilities.aspectRatioOptions}
                      id="aspectRatio"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}
            </div>
          ) : (
            <div className="mt-auto flex flex-wrap items-center gap-1">
              {/* Model Selector */}
              <ModelSelectorDropdown
                config={config}
                modelParam={modelParam}
                isOpen={isModelOpen}
                setIsOpen={setIsModelOpen}
                modelSearch={modelSearch}
                setModelSearch={setModelSearch}
                onSelect={handleModelSelect}
              />

              {/* Quality Selector */}
              {config.qualityOptions.length > 0 && (
                <Popover.Root open={isQualityOpen} onOpenChange={setIsQualityOpen}>
                  <Popover.Trigger asChild>
                    <button type="button" className={PILL}>
                      {quality}
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] bg-transparent">
                      <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[110px] overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] p-1 shadow-xl">
                        {config.qualityOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setQuality(opt);
                              setIsQualityOpen(false);
                            }}
                            className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                              opt === quality ? "bg-[#D97757]/10 text-[#D97757]" : "text-neutral-300 hover:bg-[#1e1e1e]"
                            }`}
                          >
                            {opt}
                            {config.premiumQualityOptions?.includes(opt) && (
                              <span className="ml-1 text-[10px] text-[#D97757]">Pro</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              )}

              {/* Aspect Ratio Selector — shared 200px Higgsfield-style popup,
                  replacing the old narrow black text-only dropdown. */}
              <AspectRatioPopover
                value={aspectRatio}
                onChange={setAspectRatio}
                options={toRatioChoices(config.aspectRatioOptions)}
                id="legacyAspectRatio"
                openId={openPopoverId}
                onOpenIdChange={setOpenPopoverId}
              />

              {/* Count Control */}
              <div className={PILL}>
                <button
                  type="button"
                  onClick={() => setCount(Math.max(1, count - 1))}
                  disabled={count <= 1}
                  className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
                >
                  <span className="text-xs font-bold">−</span>
                </button>
                <span className="w-6 text-center font-semibold tabular-nums text-white text-xs">
                  {count}/{config.maxCount}
                </span>
                <button
                  type="button"
                  onClick={() => setCount(Math.min(config.maxCount, count + 1))}
                  disabled={count >= config.maxCount}
                  className="flex size-4 items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-40"
                >
                  <span className="text-xs font-bold">+</span>
                </button>
              </div>

              {/* Draw Button */}
              {config.showDraw && (
                <button type="button" onClick={() => onDrawOpen?.(true)} className={PILL}>
                  <span>✏️</span>
                  <span>Draw</span>
                </button>
              )}
            </div>
          )}
        </form>

        {/* Soul 2.0 Character + General cards — sit beside Generate, never
            inside the compact bottom control row. */}
        {capabilities?.characterCards && (
          <div className="flex shrink-0 items-center gap-2 self-center">
            <CharacterCardPopover />
            <SoulGeneralCard
              selected={soulGeneralSelected}
              onToggle={() => setSoulGeneralSelected((v) => !v)}
            />
          </div>
        )}

        {/* Generate Button */}
        <button
          type="submit"
          aria-label="Generate"
          className="relative flex shrink-0 flex-col items-center justify-center gap-1 self-end overflow-hidden rounded-xl border-0 font-bold uppercase text-black transition-all duration-200 ease-out hover:brightness-90 active:brightness-[0.8] focus:outline-none focus:ring-offset-2 focus:ring-offset-black"
          style={{
            width: 120,
            height: 80,
            background: "linear-gradient(135deg, #D97757 0%, #B85A3E 100%)",
            boxShadow: "10px 34px 24px 0 rgba(0,0,0,0.15), 8px 21px 6px 0 rgba(0,0,0,0.01), 3px 7px 5px 0 rgba(0,0,0,0.25), 1px 3px 4px 0 rgba(0,0,0,0.43), 0 1px 2px 0 rgba(0,0,0,0.49), inset 0px -3px 0px 0px #8A4A32, inset 0px -2px 0px 0px #8A4A32, inset 0px 1px 0px 0px #F0A98C",
            textShadow: "rgba(255,255,255,0.45) 0px 0px 8px",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute left-[39px] top-[36px] h-[136px] w-[76px] rounded-[50%] mix-blend-plus-lighter blur-[41.5px]"
            style={{
              background: "#D97757",
              transform: "rotate(102.79deg) skewX(0.89deg)",
            }}
          />
          <span className="relative z-10 text-xs font-bold leading-[18px]">Generate</span>
          <span className="relative z-10 flex h-4 items-center justify-center gap-0.5 text-[11px] font-semibold normal-case">
            <span>✨</span>
            {config.generateCredits}
          </span>
        </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        id="image-form-reference"
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp"
        className="sr-only"
      />

      <Cinema25AssetsPicker
        isOpen={assetsPickerOpen}
        onClose={() => setAssetsPickerOpen(false)}
        context="reference"
        onSelectAsset={assetsPickerElementsMode ? addElementFromPicker : addAssetFromPicker}
        showElementsTab={assetsPickerElementsMode}
        initialTab={assetsPickerElementsMode ? "elements" : "uploads"}
      />

      <ColorTransferPanel
        isOpen={colorTransferOpen}
        onClose={() => setColorTransferOpen(false)}
        swatches={colorTransferSwatches}
        onAddSwatch={(swatch) => updateColorTransferForModel({ swatches: [...colorTransferSwatches, swatch] })}
        onRemoveSwatch={(id) =>
          updateColorTransferForModel({ swatches: colorTransferSwatches.filter((s) => s.id !== id) })
        }
        selectedId={colorTransferSelectedId}
        onSelect={(id) => updateColorTransferForModel({ selectedId: id })}
      />
    </div>
  );
}

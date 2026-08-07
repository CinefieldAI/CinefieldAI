"use client";

import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  Blend,
  Gauge,
  Gem,
  ImagePlus,
  Loader2,
  Pencil,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";

const DEFAULT_IMAGE_PROMPT_WIDTH = 1060;
const MAX_IMAGE_PROMPT_WIDTH = 1240;
const DEFAULT_IMAGE_PROMPT_HEIGHT = 140;
const MAX_IMAGE_PROMPT_HEIGHT = 360;
import Cinema25AssetsPicker from "@/components/cinema-studio/Cinema25AssetsPicker";
import GenerateButton from "@/components/cinema-studio/GenerateButton";
import AttachmentPreview from "./AttachmentPreview";
import ModelSelector from "./ModelSelector";
import { OUTPUT_COUNTS, type ReferenceAttachment } from "./createImageData";
import { PROMPT_BAR_SURFACE } from "@/lib/promptBarChassis";
import {
  getCapabilities,
  KLING_O1_RESOLUTION_OPTIONS,
  STANDARD_ASPECT_RATIOS,
} from "./imageModelCapabilities";
import {
  AspectRatioPopover,
  AssetsButtonGroup,
  BatchSizeCounter,
  EnhancementToggle,
  QualityPopover,
  ResolutionPopover,
  SettingsPopover,
  type FluxFlexSettings,
} from "./ModelCapabilityControls";

interface PromptComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedModel: string;
  onSelectModel: (name: string) => void;
  onGenerate: (payload: { prompt: string; model: string }) => Promise<void> | void;
}

let attachmentCounter = 0;

// Shared premium pill-chip styling for the bottom tool row
const CHIP =
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all duration-[160ms] ease-out hover:-translate-y-px active:scale-[0.98] active:duration-100 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-75";
const CHIP_IDLE =
  "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.055)] text-[rgba(255,255,255,0.78)] hover:border-[rgba(255,255,255,0.14)] hover:bg-[rgba(255,255,255,0.09)] hover:text-[rgba(255,255,255,0.95)]";
const CHIP_ACTIVE =
  "border-[rgba(0,229,255,0.55)] bg-[rgba(0,229,255,0.12)] text-white";
const CHIP_OPEN =
  "data-[state=open]:border-[rgba(0,229,255,0.55)] data-[state=open]:bg-[rgba(0,229,255,0.12)] data-[state=open]:text-white";

const GENERATION_MODES = ["Mid", "Fast", "Standard", "Pro"] as const;
const QUALITY_LEVELS = ["1K", "2K", "4K"] as const;

function ListPopover<T extends string>({
  title,
  options,
  value,
  onChange,
  trigger,
}: {
  title: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  trigger: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-44">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </p>
        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const isActive = value === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-magenta-500/15 text-magenta-400"
                    : "text-zinc-300 hover:bg-white/[0.05]"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GenerationModeSelector({
  value,
  onChange,
}: {
  value: (typeof GENERATION_MODES)[number];
  onChange: (value: (typeof GENERATION_MODES)[number]) => void;
}) {
  return (
    <ListPopover
      title="Generation Mode"
      options={GENERATION_MODES}
      value={value}
      onChange={onChange}
      trigger={
        <button type="button" title="Generation mode" className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}>
          <Gauge />
          {value}
        </button>
      }
    />
  );
}

function QualitySelector({
  value,
  onChange,
  options = QUALITY_LEVELS,
}: {
  value: (typeof QUALITY_LEVELS)[number];
  onChange: (value: (typeof QUALITY_LEVELS)[number]) => void;
  /** Kling O1 restricts this to 1K/2K only (no 4K). */
  options?: readonly (typeof QUALITY_LEVELS)[number][];
}) {
  return (
    <ListPopover
      title="Quality"
      options={options}
      value={value}
      onChange={onChange}
      trigger={
        <button type="button" title="Quality" className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}>
          <Aperture />
          {value}
        </button>
      }
    />
  );
}

function OutputCountSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (count: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Output count"
          className={`${CHIP} ${CHIP_IDLE} ${CHIP_OPEN}`}
        >
          <span className="grid grid-cols-2 gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-[1px] ${
                  i < value ? "bg-magenta-400" : "bg-zinc-600"
                }`}
              />
            ))}
          </span>
          {value}/4
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} className="w-40">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Output Count
        </p>
        <div className="flex gap-1.5">
          {OUTPUT_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onChange(count)}
              className={`flex h-8 flex-1 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                value === count
                  ? "bg-magenta-500/15 text-magenta-400 ring-1 ring-magenta-500/40"
                  : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* The old narrow black text-only aspect-ratio dropdown has been retired —
 * every model (capability-driven and legacy/generic) now shares the same
 * AspectRatioPopover from ModelCapabilityControls.tsx. See the legacy
 * fallback row below for where it's wired up with STANDARD_ASPECT_RATIOS. */

export default function PromptComposer({
  prompt,
  onPromptChange,
  selectedModel,
  onSelectModel,
  onGenerate,
}: PromptComposerProps) {
  const [attachments, setAttachments] = useState<ReferenceAttachment[]>([]);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [outputCount, setOutputCount] = useState(1);
  const [genMode, setGenMode] = useState<(typeof GENERATION_MODES)[number]>("Standard");
  const [quality, setQuality] = useState<(typeof QUALITY_LEVELS)[number]>("2K");
  const [drawMode, setDrawMode] = useState(false);
  const [colorTransfer, setColorTransfer] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Model-specific capability-driven state (GPT Image 2 / Soul Cinema / Studio
  // Digital S35 / WAN 2.2). Kept separate from the legacy generic controls
  // above so every other model's behavior is untouched.
  const capabilities = getCapabilities(selectedModel);
  const [gptQuality, setGptQuality] = useState("High");
  const [modelQuality, setModelQuality] = useState(capabilities?.defaultQuality ?? "Standard");
  const [modelResolution, setModelResolution] = useState(capabilities?.defaultResolution ?? "2K");
  const [modelAspectRatio, setModelAspectRatio] = useState(capabilities?.defaultAspectRatio ?? "16:9");
  const [modelBatch, setModelBatch] = useState(capabilities?.defaultBatchSize ?? 1);
  const [enhancementEnabled, setEnhancementEnabled] = useState(capabilities?.defaultEnhancement ?? true);
  const [fluxFlexSettings, setFluxFlexSettings] = useState<FluxFlexSettings>({
    strength: 50,
    guidance: 50,
  });
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
  // Element references are a distinct reference type from uploaded/generated
  // image attachments, kept per-model so Seedream 4.5 and Seedream 5.0 Lite
  // never share or overwrite each other's selections.
  const [elementReferencesByModel, setElementReferencesByModel] = useState<
    Record<string, ReferenceAttachment[]>
  >({});
  const elementReferences = elementReferencesByModel[selectedModel] ?? [];
  // Ensures only one model-specific popover (quality/resolution/aspect/grid)
  // is open at a time within the capability-driven control row.
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);

  // Reset per-model defaults whenever the selected model changes so no stale
  // control values leak from the previously selected model. Adjusting state
  // during render (rather than in an effect) avoids an extra commit + re-render.
  const [prevModelForReset, setPrevModelForReset] = useState(selectedModel);
  if (selectedModel !== prevModelForReset) {
    setPrevModelForReset(selectedModel);
    if (capabilities) {
      setModelQuality(capabilities.defaultQuality ?? "Standard");
      setModelResolution(capabilities.defaultResolution ?? "2K");
      setModelAspectRatio(capabilities.defaultAspectRatio ?? "16:9");
      setModelBatch(capabilities.defaultBatchSize ?? 1);
      setEnhancementEnabled(capabilities.defaultEnhancement ?? true);
    } else {
      // Legacy/generic-panel models (Higgsfield Soul, Nano Banana family,
      // Seedream family, Grok Imagine, Recraft V4.1, GPT Image / 1.5, Kling
      // O1, Z-Image, Auto, ...) share one control row but must not leak one
      // model's aspect ratio/quality/batch into the next — reset on switch.
      // (Also safely migrates a stale 4K selection away from Kling O1,
      // which no longer offers that resolution.)
      setAspectRatio("3:4");
      setQuality("2K");
      setOutputCount(1);
      setGenMode("Standard");
    }
    setOpenPopoverId(null);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Keep the contenteditable in sync when the prompt is set externally (e.g. "reuse")
  useEffect(() => {
    const el = editorRef.current;
    if (el && el.textContent !== prompt && document.activeElement !== el) {
      el.textContent = prompt;
    }
  }, [prompt]);

  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        for (const a of prev) {
          if (a.url) URL.revokeObjectURL(a.url);
        }
        return prev;
      });
    };
  }, []);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));

    const placeholders = incoming.map((file) => {
      attachmentCounter += 1;
      return { id: `att-${attachmentCounter}`, file };
    });

    setAttachments((prev) => [
      ...prev,
      ...placeholders.map(({ id, file }) => ({
        id,
        url: "",
        name: file.name,
        loading: true,
      })),
    ]);

    placeholders.forEach(({ id, file }) => {
      const url = URL.createObjectURL(file);
      setTimeout(() => {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, url, loading: false } : a)),
        );
      }, 700);
    });
  };

  const addAssetFromPicker = (url: string) => {
    attachmentCounter += 1;
    setAttachments((prev) => [
      ...prev,
      { id: `att-${attachmentCounter}`, url, name: "Selected asset", loading: false },
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
    attachmentCounter += 1;
    setElementReferencesByModel((prev) => {
      const existing = prev[selectedModel] ?? [];
      return {
        ...prev,
        [selectedModel]: [
          ...existing,
          { id: `element-${attachmentCounter}`, url, name: "Selected element", loading: false },
        ],
      };
    });
  };
  const removeElementReference = (id: string) => {
    setElementReferencesByModel((prev) => {
      const existing = prev[selectedModel] ?? [];
      const found = existing.find((a) => a.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return { ...prev, [selectedModel]: existing.filter((a) => a.id !== id) };
    });
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt.trim() && attachments.length === 0) return;
    setIsGenerating(true);
    try {
      await onGenerate({ prompt, model: selectedModel });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleGenerate();
    }
  };

  // Resizable prompt surface state (height resize up/down via top handle)
  const [promptWidth, setPromptWidth] = useState(DEFAULT_IMAGE_PROMPT_WIDTH);
  const [promptHeight, setPromptHeight] = useState(DEFAULT_IMAGE_PROMPT_HEIGHT);
  const [maxPromptWidth, setMaxPromptWidth] = useState(MAX_IMAGE_PROMPT_WIDTH);
  const [maxPromptHeight, setMaxPromptHeight] = useState(MAX_IMAGE_PROMPT_HEIGHT);

  useEffect(() => {
    const updateResizeBounds = () => {
      const nextMaxWidth = Math.max(
        320,
        Math.min(MAX_IMAGE_PROMPT_WIDTH, window.innerWidth - 32),
      );
      const nextMaxHeight = Math.max(
        DEFAULT_IMAGE_PROMPT_HEIGHT,
        Math.min(MAX_IMAGE_PROMPT_HEIGHT, window.innerHeight - 160),
      );
      setMaxPromptWidth(nextMaxWidth);
      setMaxPromptHeight(nextMaxHeight);
    };

    updateResizeBounds();
    window.addEventListener("resize", updateResizeBounds);
    return () => window.removeEventListener("resize", updateResizeBounds);
  }, []);

  const promptResize = usePromptSurfaceResize({
    width: promptWidth,
    height: promptHeight,
    minWidth: Math.min(DEFAULT_IMAGE_PROMPT_WIDTH, maxPromptWidth),
    maxWidth: maxPromptWidth,
    minHeight: DEFAULT_IMAGE_PROMPT_HEIGHT,
    maxHeight: maxPromptHeight,
    defaultWidth: DEFAULT_IMAGE_PROMPT_WIDTH,
    defaultHeight: DEFAULT_IMAGE_PROMPT_HEIGHT,
    setWidth: setPromptWidth,
    setHeight: setPromptHeight,
    storageKey: "imagePromptBarDimensions",
  });

  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  return (
    <>
      <div
        id="image-prompt-popover-root"
        ref={setPortalRoot}
        className="pointer-events-none fixed left-0 top-0 z-[100000]"
      />
      <div
        className={`fixed bottom-[18px] left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100vw-32px)] ${
          promptResize.isResizing ? "" : "transition-[width,height] duration-150 ease-out"
        }`}
        style={{
          width: promptWidth,
          height: Math.max(DEFAULT_IMAGE_PROMPT_HEIGHT, promptHeight),
          minHeight: `${DEFAULT_IMAGE_PROMPT_HEIGHT}px`,
        }}
      >
      {/* Outer Illuminated Glowing Border (Matches Generate #D97757 orange glow) */}
      <div className="relative rounded-[24px] w-full h-full">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[1px] rounded-[24px] border-2 border-[#D97757] opacity-85 shadow-[0_0_25px_rgba(217,119,87,0.75)] animate-pulse z-30"
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleGenerate();
          }}
          style={{
            background:
              "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
            border: "1px solid rgba(217, 119, 87, 0.45)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
          className="prompt-main-surface relative flex min-w-0 w-full h-full items-stretch gap-1 rounded-[24px] p-3 overflow-hidden"
        >
          {/* Top handle for vertical height resize */}
          <PromptResizeHandles
            verticalHandleProps={promptResize.verticalHandleProps}
            cornerHandleProps={promptResize.cornerHandleProps}
            isResizing={promptResize.isResizing}
            verticalLabel="Resize image prompt height"
            cornerLabel="Resize image prompt width and height"
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Recraft V4.1 Utility — single decorative centered utility shell */}
          {selectedModel === "Recraft V4.1 Utility" && (
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-0.5 z-10 transition-opacity duration-200"
              style={{
                borderRadius: "20px",
                left: "calc(50% + 38px)",
                right: "auto",
                transform: "translateX(-50%)",
                width: "360px",
                height: "56px",
                top: "calc(100% - 58px)",
                border: "1.5px solid rgba(209,254,23,0.9)",
                boxShadow:
                  "0 0 35px rgba(209,254,23,0.55), inset 0 0 20px rgba(209,254,23,0.35)",
                background:
                  "linear-gradient(180deg, rgba(209,254,23,0.12) 0%, rgba(209,254,23,0.03) 100%)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
              }}
            >
              <div
                className="absolute left-0 right-0 overflow-hidden"
                style={{
                  bottom: "calc(100% - 30px)",
                  borderTopLeftRadius: "20px",
                  borderTopRightRadius: "20px",
                  background:
                    "linear-gradient(180deg, rgba(209,254,23,0.08), rgba(209,254,23,0))",
                }}
              />
            </div>
          )}

          {/* Left Column: Text editor (top) + controls row (mt-auto bottom) */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-start gap-1">
              {attachments.length > 0 && (
                <div className="mb-2">
                  <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
                </div>
              )}
              {elementReferences.length > 0 && (
                <div className="mb-2">
                  <AttachmentPreview attachments={elementReferences} onRemove={removeElementReference} />
                </div>
              )}

              <div className="flex items-start gap-2.5 flex-1 min-h-[24px]">
                {!capabilities && selectedModel !== "Z-Image" && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Add reference image"
                    className="group flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-all duration-200 ease-out hover:bg-white/[0.06] hover:text-white hover:shadow-[0_0_12px_rgba(0,229,255,0.25)] active:scale-95"
                  >
                    <ImagePlus className="h-4 w-4 transition-transform duration-200 ease-out group-hover:rotate-[3deg]" />
                  </button>
                )}

                <div
                  className="relative min-w-0 flex-1 h-full cursor-text"
                  onClick={() => editorRef.current?.focus()}
                >
                  <div
                    ref={editorRef}
                    contentEditable={true}
                    suppressContentEditableWarning
                    role="textbox"
                    tabIndex={0}
                    aria-multiline="true"
                    aria-label="Prompt"
                    onInput={(e) => onPromptChange(e.currentTarget.textContent ?? "")}
                    onKeyDown={handleEditorKeyDown}
                    style={{
                      minHeight: "24px",
                      maxHeight: "100%",
                      paddingTop: "4px",
                      paddingLeft: "2px",
                      fontSize: "15px",
                      lineHeight: 1.55,
                      letterSpacing: "-0.01em",
                      color: "rgba(255,255,255,0.92)",
                      caretColor: "#00e5ff",
                    }}
                    className="relative z-10 w-full h-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent outline-none cursor-text"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute select-none transition-opacity duration-200 ease-out z-0"
                    style={{
                      left: "2px",
                      top: "4px",
                      fontSize: "15px",
                      fontWeight: 400,
                      lineHeight: 1.55,
                      letterSpacing: "-0.01em",
                      color: "rgba(255,255,255,0.42)",
                      opacity: prompt ? 0 : 1,
                    }}
                  >
                    Describe the scene you imagine
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom control row: mt-auto */}
            <div className="prompt-control-row mt-auto flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
              <ModelSelector selected={selectedModel} onSelect={onSelectModel} portalContainer={portalRoot} />

              {capabilities ? (
                <>
                  {selectedModel === "GPT Image 2" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "🚫 Cinefield Soul Cinema" && (
                    <>
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

                  {selectedModel === "WAN 2.2" && (
                    <>
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
                        icon={<Wand2 className="h-4 w-4" style={{ color: enhancementEnabled ? "rgb(209,254,23)" : undefined }} />}
                      />
                    </>
                  )}

                  {(selectedModel === "Multi Reference" ||
                    selectedModel === "Flux Kontext Max" ||
                    selectedModel === "FLUX.2 Max") && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                      )}
                      <ModelSelector selected={selectedModel} onSelect={onSelectModel} size="mini" />
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

                  {selectedModel === "FLUX.2 Pro" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                      )}
                      <ModelSelector selected={selectedModel} onSelect={onSelectModel} size="mini" />
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

                  {selectedModel === "FLUX.2 Flex" && (
                    <>
                      <ModelSelector selected={selectedModel} onSelect={onSelectModel} size="mini" />
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

                  {(selectedModel === "🚫 Cinefield Soul 2.0" || selectedModel === "🚫 Cinefield Soul") && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "Grok Imagine" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup onOpenPicker={openUploadsPicker} />
                      )}
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

                  {selectedModel === "Seedream 4.0" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup onOpenPicker={openUploadsPicker} showElementButton={false} />
                      )}
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

                  {selectedModel === "Seedream 4.5" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "Seedream 5.0 Lite" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "Seedream 5.0 Pro" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {(selectedModel === "Nano Banana Pro" || selectedModel === "Nano Banana 2") && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "Nano Banana 2 Lite" && (
                    <>
                      {capabilities.assetUpload && (
                        <AssetsButtonGroup
                          onOpenPicker={openUploadsPicker}
                          onOpenElementsPicker={openElementsPicker}
                        />
                      )}
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

                  {selectedModel === "Z-Image" && (
                    <>
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
                </>
              ) : (
                <>
                  <GenerationModeSelector value={genMode} onChange={setGenMode} />
                  <QualitySelector
                    value={quality}
                    onChange={setQuality}
                    options={selectedModel === "Kling O1" ? KLING_O1_RESOLUTION_OPTIONS : QUALITY_LEVELS}
                  />
                  <AspectRatioPopover
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    options={STANDARD_ASPECT_RATIOS}
                    id="legacyAspectRatio"
                    openId={openPopoverId}
                    onOpenIdChange={setOpenPopoverId}
                  />
                  <OutputCountSelector value={outputCount} onChange={setOutputCount} />
                  <button
                    type="button"
                    onClick={() => setDrawMode((v) => !v)}
                    aria-pressed={drawMode}
                    className={`${CHIP} ${drawMode ? CHIP_ACTIVE : CHIP_IDLE}`}
                  >
                    <Pencil />
                    Draw
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorTransfer((v) => !v)}
                    aria-pressed={colorTransfer}
                    className={`${CHIP} ${colorTransfer ? CHIP_ACTIVE : CHIP_IDLE}`}
                  >
                    <Blend />
                    Color Transfer
                  </button>
                  <button type="button" className={`${CHIP} ${CHIP_IDLE}`}>
                    <Sparkles />
                    Enhance Prompt
                  </button>
                  <button type="button" className={`${CHIP} ${CHIP_IDLE}`}>
                    <Wand2 />
                    Magic Prompt
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right Column: Generate button (flex h-[96px] shrink-0 items-end self-end) */}
          <div className="flex h-[96px] shrink-0 items-end justify-center gap-2 self-end">
            <GenerateButton
              height={96}
              creditCost={40}
              onGenerate={handleGenerate}
              mode="image"
              isLoading={isGenerating}
            />
          </div>

          <Cinema25AssetsPicker
            isOpen={assetsPickerOpen}
            onClose={() => setAssetsPickerOpen(false)}
            context="reference"
            onSelectAsset={assetsPickerElementsMode ? addElementFromPicker : addAssetFromPicker}
            showElementsTab={assetsPickerElementsMode}
            initialTab={assetsPickerElementsMode ? "elements" : "uploads"}
          />
        </form>
      </div>
    </div>
  </>
  );
}

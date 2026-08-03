"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import CinemaModelSelector from "./ModelSelector";
import GenerateButton from "./GenerateButton";
import Cinema25AssetsPicker from "./Cinema25AssetsPicker";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import { usePromptSurfaceResize } from "@/hooks/usePromptSurfaceResize";
import ColorTransferPanel, {
  type ColorTransferSwatch,
} from "@/components/image-tools/ColorTransferPopover";
import { getModel } from "./cinemaStudioData";
import AttachmentPreview from "@/components/landing/createImage/AttachmentPreview";
import type { ReferenceAttachment } from "@/components/landing/createImage/createImageData";
import {
  getCapabilities,
  STANDARD_ASPECT_RATIOS,
} from "@/components/landing/createImage/imageModelCapabilities";
import {
  AspectRatioPopover,
  BatchSizeCounter,
  EnhancementToggle,
  LabeledToggle,
  QualityPopover,
  ResolutionPopover,
  SettingsPopover,
  type FluxFlexSettings,
} from "@/components/landing/createImage/ModelCapabilityControls";

interface CinemaStudioImagePanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  model: string;
  onModelChange: (id: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  creditCost: number;
}

const LEGACY_RESOLUTION_OPTIONS = [
  { value: "1K", description: "" },
  { value: "2K", description: "" },
  { value: "4K", description: "" },
];

/**
 * Cinema Studio's Image-mode composer — reuses the exact same capability
 * system, popovers, and shared Assets Picker built for /generate/image so
 * there's a single image-generation implementation across the app. Video
 * mode (Cinema Studio 2.5/3.0/3.5) is untouched; this only renders when
 * CinemaStudioWorkspace's `mode === "image"`.
 */
export default function CinemaStudioImagePanel({
  prompt,
  onPromptChange,
  model,
  onModelChange,
  onGenerate,
  isGenerating,
  creditCost,
}: CinemaStudioImagePanelProps) {
  const selectedModel = getModel(model);
  // cinemaStudioData.ts uses the all-caps "FLUX.2 MAX" label; the shared
  // capability map (built for /generate/image) keys it as "FLUX.2 Max".
  const capabilityName = selectedModel.name === "FLUX.2 MAX" ? "FLUX.2 Max" : selectedModel.name;
  const capabilities = getCapabilities(capabilityName);

  const [gptQuality, setGptQuality] = useState("High");
  const [modelQuality, setModelQuality] = useState(capabilities?.defaultQuality ?? "Pro");
  const [modelResolution, setModelResolution] = useState(capabilities?.defaultResolution ?? "2K");
  const [modelAspectRatio, setModelAspectRatio] = useState(capabilities?.defaultAspectRatio ?? "16:9");
  const [modelBatch, setModelBatch] = useState(1);
  const [enhancementEnabled, setEnhancementEnabled] = useState(capabilities?.defaultEnhancement ?? true);
  const [vectorMode, setVectorMode] = useState(capabilities?.defaultVectorMode ?? false);
  const [colorTransferOpen, setColorTransferOpen] = useState(false);
  const [colorTransferSwatches, setColorTransferSwatches] = useState<ColorTransferSwatch[]>([]);
  const [colorTransferSelectedId, setColorTransferSelectedId] = useState<string | null>(null);
  const colorTransfer = colorTransferSelectedId !== null;
  const [fluxFlexSettings, setFluxFlexSettings] = useState<FluxFlexSettings>({
    strength: 50,
    guidance: 50,
  });
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<ReferenceAttachment[]>([]);

  // Legacy/generic state for models with no dedicated capability entry yet
  // (Cinematic models category — AI Cast / Cinematic Locations / Soul Cinema
  // / Cinematic Cameras — plus Reve, Grok Imagine, Seedream family, etc.).
  const [legacyAspectRatio, setLegacyAspectRatio] = useState("16:9");
  const [legacyResolution, setLegacyResolution] = useState("2K");
  const [legacyBatch, setLegacyBatch] = useState(4);

  const [prevModelForReset, setPrevModelForReset] = useState(model);
  if (model !== prevModelForReset) {
    setPrevModelForReset(model);
    if (capabilities) {
      setModelQuality(capabilities.defaultQuality ?? "Pro");
      setModelResolution(capabilities.defaultResolution ?? "2K");
      setModelAspectRatio(capabilities.defaultAspectRatio ?? "16:9");
      setModelBatch(1);
      setEnhancementEnabled(capabilities.defaultEnhancement ?? true);
      setVectorMode(capabilities.defaultVectorMode ?? false);
      setColorTransferSelectedId(null);
    } else {
      setLegacyAspectRatio("16:9");
      setLegacyResolution("2K");
      setLegacyBatch(4);
    }
    setOpenPopoverId(null);
  }

  const showPlus = capabilities ? capabilities.assetUpload : selectedModel.name !== "Z-Image";

  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = editorRef.current;
    if (el && el.textContent !== prompt) {
      el.textContent = prompt;
    }
  }, [prompt]);

  const addAssetFromPicker = (url: string) => {
    setAttachments((prev) => [
      ...prev,
      { id: `att-${prev.length + 1}`, url, name: "Selected asset", loading: false },
    ]);
  };
  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleFilesUpload = (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (fileArray.length === 0) return;

    setAttachments((prev) => {
      const currentCount = prev.length;
      const MAX_IMAGES = 50;
      if (currentCount >= MAX_IMAGES) {
        alert("Maximum limit of 50 images reached for this session.");
        return prev;
      }

      const availableSlots = MAX_IMAGES - currentCount;
      const filesToProcess = fileArray.slice(0, availableSlots);

      if (fileArray.length > availableSlots) {
        alert(`Maximum session limit is 50 images. Uploaded ${availableSlots} of ${fileArray.length} selected files.`);
      }

      const newAttachments: ReferenceAttachment[] = filesToProcess.map((file, idx) => ({
        id: `att-${Date.now()}-${currentCount + idx}-${Math.random().toString(36).substring(2, 6)}`,
        url: URL.createObjectURL(file),
        name: file.name,
        loading: false,
      }));

      return [...prev, ...newAttachments];
    });
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  };

  const [promptWidth, setPromptWidth] = useState(1060);
  const [promptHeight, setPromptHeight] = useState(160);

  const promptResize = usePromptSurfaceResize({
    width: promptWidth,
    height: promptHeight,
    minWidth: 700,
    maxWidth: 1240,
    minHeight: 116,
    maxHeight: 400,
    defaultWidth: 1060,
    defaultHeight: 160,
    setWidth: setPromptWidth,
    setHeight: setPromptHeight,
    storageKey: "imagePromptDimensions",
  });

  return (
    <div
      className="relative w-full"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFilesUpload(e.target.files);
          e.target.value = "";
        }}
      />
      <PromptResizeHandles
        verticalHandleProps={promptResize.verticalHandleProps}
        cornerHandleProps={promptResize.cornerHandleProps}
        isResizing={promptResize.isResizing}
        verticalLabel="Resize generate prompt height"
        cornerLabel="Resize generate prompt width and height"
      />
      {/* Full frame glowing pulsing orange border shimmer overlay */}
      <div className="pointer-events-none absolute -inset-[1px] rounded-[25px] border-2 border-[#D97757] opacity-85 shadow-[0_0_25px_rgba(217,119,87,0.75)] animate-pulse z-30" />
      <div
        className="prompt-main-surface relative flex min-w-0 flex-1 items-stretch gap-3 rounded-[20px] p-3 overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
          border: "1px solid rgba(217, 119, 87, 0.45)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {isDragging && (
          <div className="absolute inset-0 z-40 flex items-center justify-center rounded-[20px] bg-[#141414]/90 border-2 border-dashed border-[#D97757] backdrop-blur-md transition-all duration-150">
            <div className="flex flex-col items-center gap-2 text-[#D97757]">
              <Plus className="size-8 animate-bounce" />
              <span className="text-sm font-semibold text-white">Drop images here (Max 50)</span>
            </div>
          </div>
        )}
        <div className="prompt-shimmer-light pointer-events-none absolute left-3 top-2.5 z-0 h-10 w-48 opacity-40" />
        <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between gap-2">
          {attachments.length > 0 && (
            <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
          )}

          <div className="flex min-w-0 items-start gap-2">
            {showPlus && (
              <div className="flex h-8 items-center rounded-lg border border-[rgba(217,119,87,0.45)] bg-[rgba(5,5,6,0.96)]">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add image"
                  title="Upload images (Max 50)"
                  className="flex h-8 w-8 items-center justify-center rounded-l-lg text-neutral-400 hover:bg-white/10 transition-colors"
                >
                  <Plus className="size-4 text-white/80" />
                </button>
                <div className="h-4 w-px bg-white/20" />
                <button
                  type="button"
                  onClick={() => setAssetsPickerOpen(true)}
                  aria-label="Elements"
                  className="flex h-8 w-8 items-center justify-center rounded-r-lg text-neutral-400 hover:bg-white/10 transition-colors"
                >
                  <span className="text-xs font-bold text-white/80">@</span>
                </button>
              </div>
            )}

            <div className="min-w-0 flex-1">
              <textarea
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Describe the scene you imagine"
                rows={1}
                className="w-full resize-none overflow-hidden bg-transparent px-1 text-sm leading-5 text-white placeholder-neutral-500 focus:outline-none"
              />
            </div>
          </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <CinemaModelSelector value={model} onChange={onModelChange} mode="image" />

          {capabilities ? (
            <>
              {selectedModel.name === "GPT Image 2" && (
                <>
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
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {selectedModel.name === "Higgsfield Soul Cinema" && (
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

              {(selectedModel.name === "Multi Reference" ||
                selectedModel.name === "Flux Kontext Max" ||
                capabilityName === "FLUX.2 Max") && (
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
                  <EnhancementToggle
                    enabled={enhancementEnabled}
                    onToggle={() => setEnhancementEnabled((v) => !v)}
                  />
                </>
              )}

              {selectedModel.name === "FLUX.2 Pro" && (
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
                      detailed
                      id="resolution"
                      openId={openPopoverId}
                      onOpenIdChange={setOpenPopoverId}
                    />
                  )}
                  <BatchSizeCounter value={modelBatch} onChange={setModelBatch} />
                </>
              )}

              {selectedModel.name === "FLUX.2 Flex" && (
                <SettingsPopover
                  settings={fluxFlexSettings}
                  onChange={setFluxFlexSettings}
                  id="settings"
                  openId={openPopoverId}
                  onOpenIdChange={setOpenPopoverId}
                />
              )}

              {(selectedModel.name === "Recraft V4.1 Utility" ||
                selectedModel.name === "Recraft V4.1") && (
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
                  <LabeledToggle
                    label="Vector mode"
                    enabled={vectorMode}
                    onToggle={() => setVectorMode((v) => !v)}
                  />
                  <LabeledToggle
                    label="Color transfer"
                    enabled={colorTransfer}
                    onToggle={() => setColorTransferOpen(true)}
                  />
                </>
              )}

              {selectedModel.name === "WAN 2.2" && (
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
                  />
                </>
              )}
            </>
          ) : (
            <>
              <ResolutionPopover
                value={legacyResolution}
                onChange={setLegacyResolution}
                options={LEGACY_RESOLUTION_OPTIONS}
                id="legacyResolution"
                openId={openPopoverId}
                onOpenIdChange={setOpenPopoverId}
              />
              <AspectRatioPopover
                value={legacyAspectRatio}
                onChange={setLegacyAspectRatio}
                options={STANDARD_ASPECT_RATIOS}
                id="legacyAspectRatio"
                openId={openPopoverId}
                onOpenIdChange={setOpenPopoverId}
              />
              <BatchSizeCounter value={legacyBatch} onChange={setLegacyBatch} max={10} />
            </>
          )}
        </div>
      </div>

      <GenerateButton
        creditCost={creditCost}
        onGenerate={onGenerate}
        mode="image"
        isLoading={isGenerating}
      />
      </div>

      <Cinema25AssetsPicker
        isOpen={assetsPickerOpen}
        onClose={() => setAssetsPickerOpen(false)}
        context="reference"
        onSelectAsset={addAssetFromPicker}
      />

      <ColorTransferPanel
        isOpen={colorTransferOpen}
        onClose={() => setColorTransferOpen(false)}
        swatches={colorTransferSwatches}
        onAddSwatch={(swatch) => setColorTransferSwatches((prev) => [...prev, swatch])}
        onRemoveSwatch={(id) =>
          setColorTransferSwatches((prev) => prev.filter((s) => s.id !== id))
        }
        selectedId={colorTransferSelectedId}
        onSelect={setColorTransferSelectedId}
      />
    </div>
  );
}

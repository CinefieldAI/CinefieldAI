"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import CinemaModelSelector from "./ModelSelector";
import Cinema25AssetsPicker from "./Cinema25AssetsPicker";
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

  return (
    <div
      className="flex min-w-0 flex-1 items-stretch gap-1 rounded-[24px] bg-[#1a1d1f] p-3"
      style={{
        minHeight: 116,
        maxHeight: 400,
        boxShadow: "0 4px 6px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        {attachments.length > 0 && (
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
        )}

        <div className="flex min-w-0 items-start gap-2">
          {showPlus && (
            <button
              type="button"
              onClick={() => setAssetsPickerOpen(true)}
              aria-label="Add reference"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card text-white transition-colors hover:bg-white/10"
            >
              <Plus className="size-3.5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Prompt"
              data-placeholder="Describe the scene you imagine"
              onInput={(e) => onPromptChange(e.currentTarget.textContent ?? "")}
              className="max-h-[80px] min-h-[24px] overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
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

      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        aria-label="Generate"
        className="relative flex shrink-0 flex-col items-center justify-center gap-1 self-center overflow-hidden rounded-xl border-0 font-bold uppercase text-black transition-all duration-200 ease-out hover:brightness-90 active:brightness-[0.8] focus:outline-none focus:ring-2 focus:ring-[#D97757] focus:ring-offset-2 focus:ring-offset-black disabled:cursor-not-allowed disabled:opacity-80"
        style={{
          width: 120,
          height: 80,
          background: "linear-gradient(135deg, #D97757 0%, #B85A3E 100%)",
          boxShadow:
            "10px 34px 24px 0 rgba(0,0,0,0.15), 8px 21px 6px 0 rgba(0,0,0,0.01), 3px 7px 5px 0 rgba(0,0,0,0.25), 1px 3px 4px 0 rgba(0,0,0,0.43), 0 1px 2px 0 rgba(0,0,0,0.49), inset 0px -3px 0px 0px #8A4A32, inset 0px -2px 0px 0px #8A4A32, inset 0px 1px 0px 0px #F0A98C",
          textShadow: "rgba(255,255,255,0.45) 0px 0px 8px",
        }}
      >
        <span className="relative z-10 text-xs font-bold leading-[18px]">Generate</span>
        <span className="relative z-10 flex h-4 items-center justify-center gap-0.5 text-[11px] font-semibold normal-case">
          <span>✨</span>
          {creditCost}
        </span>
      </button>

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

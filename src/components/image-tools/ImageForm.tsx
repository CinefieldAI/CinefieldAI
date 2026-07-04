"use client";

import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Plus, Search, Check } from "lucide-react";
import { IMAGE_MODEL_CONFIGS, FEATURED_IMAGE_MODELS } from "@/lib/imageModelConfig";
import { useRouter, useSearchParams } from "next/navigation";

const MODEL_ICONS: Record<string, string> = {
  openai: "🤖",
  seedream: "🌈",
  google: "G",
};

const PILL = "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

const FEATURED_MODELS_LIST = [
  { id: "higgsfield-soul-2", label: "Higgsfield Soul 2.0", description: "Next generation ultra-realistic fashion visuals", icon: "google" },
  { id: "higgsfield-soul-cinema", label: "Higgsfield Soul Cinema", description: "Cinema-grade visual creation", icon: "google" },
  { id: "gpt-image-2", label: "GPT Image 2", description: "4K images with near-perfect text rendering", badge: "New", icon: "openai" },
  { id: "seedream-4-5", label: "Seedream 4.5", description: "ByteDance's next-gen 4K image model", badge: "Premium", icon: "seedream" },
  { id: "nano-banana-pro", label: "Nano Banana Pro", description: "Google's flagship generation model", icon: "google" },
  { id: "nano-banana-2", label: "Nano Banana 2", description: "Pro quality at Flash speed", badge: "Premium", icon: "google" },
  { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite", description: "Lightweight image generation at speed", badge: "New", icon: "google" },
  { id: "recraft-v4-1", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", badge: "New", icon: "google" },
];

const ALL_MODELS_LIST = [
  { id: "nano-banana", label: "Nano Banana", description: "Google's standard generation model", badge: "Premium", icon: "google" },
  { id: "higgsfield-soul", label: "Higgsfield Soul", description: "Ultra-realistic fashion visuals", icon: "google" },
  { id: "higgsfield-face-swap", label: "Higgsfield Face Swap", description: "Seamless face swapping", icon: "google" },
  { id: "higgsfield-character-swap", label: "Higgsfield Character Swap", description: "Seamless character swapping", icon: "google" },
  { id: "seedream-4-0", label: "Seedream 4.0", description: "ByteDance's advanced image editing model", badge: "Premium", icon: "seedream" },
  { id: "gpt-image-1-5", label: "GPT Image 1.5", description: "True-color precision rendering", badge: "Premium", icon: "openai" },
  { id: "grok-imagine", label: "Grok Imagine", description: "Versatile image styles by xAI", badge: "Premium", icon: "google" },
  { id: "recraft-v4-1-alt", label: "Recraft V4.1", description: "Photorealistic and expressive image generation", badge: "New", icon: "google" },
  { id: "recraft-v4-1-utility", label: "Recraft V4.1 Utility", description: "Simple scenes with flat, even lighting", badge: "New", icon: "google" },
  { id: "z-image", label: "Z-Image", description: "Instant lifelike portraits", icon: "google" },
  { id: "kling-o1", label: "Kling O1", description: "Kling's Photorealistic Image Model", badge: "Premium", icon: "google" },
  { id: "flux-2-pro", label: "FLUX.2 Pro", description: "Speed-optimized detail", icon: "google" },
  { id: "flux-2-flex", label: "FLUX.2 Flex", description: "Next-gen image generation", badge: "Premium", icon: "google" },
  { id: "flux-2-max", label: "FLUX.2 Max", description: "Ultimate precision and speed", badge: "Premium", icon: "google" },
  { id: "flux-kontext-max", label: "Flux Kontext Max", description: "Edit with accuracy", badge: "Premium", icon: "google" },
  { id: "gpt-image", label: "GPT Image", description: "Versatile text-to-image AI", badge: "Premium", icon: "openai" },
  { id: "multi-reference", label: "Multi Reference", description: "Multiple edits in one shot", badge: "Premium", icon: "google" },
  { id: "reve", label: "Reve", description: "Advanced image editing model", badge: "Premium", icon: "google" },
  { id: "seedream-5-lite", label: "Seedream 5.0 lite", description: "Intelligent visual reasoning", icon: "seedream" },
  { id: "wan-2-2", label: "WAN 2.2", description: "High-fidelity cinematic visuals", icon: "google" },
];

interface ImageFormProps {
  isDrawOpen?: boolean;
  onDrawOpen?: (open: boolean) => void;
}

export default function ImageForm({ isDrawOpen = false, onDrawOpen }: ImageFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model") || "nano-banana-pro";
  const config = IMAGE_MODEL_CONFIGS[modelParam];

  if (!config) return null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState("");
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [isAspectOpen, setIsAspectOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const [quality, setQuality] = useState(config.defaultQuality);
  const [aspectRatio, setAspectRatio] = useState(config.defaultAspectRatio);
  const [count, setCount] = useState(config.defaultCount);

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
    router.push(`/generate/image?model=${modelId}`);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-7xl px-4 z-50">
      <div
        className="flex min-w-0 flex-1 items-stretch gap-3 rounded-[24px] bg-[#1a1d1f] p-3"
        style={{
          minHeight: 116,
          maxHeight: 400,
          boxShadow: "0 4px 6px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
        }}
      >
        {/* Prompt input + controls */}
        <form className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          {/* Prompt row */}
          <div className="flex gap-2 min-w-0">
            {config.showUpload && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-card shrink-0 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]"
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
                className="max-h-[80px] min-h-[24px] overflow-y-auto px-1 text-sm leading-5 text-white focus:outline-none empty:before:pointer-events-none empty:before:text-neutral-500 empty:before:content-[attr(data-placeholder)]"
              />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Model Selector */}
            <Popover.Root open={isModelOpen} onOpenChange={setIsModelOpen}>
              <Popover.Trigger asChild>
                <button type="button" className={PILL}>
                  <span className="size-3.5 text-neutral-400 flex items-center justify-center text-xs">
                    {MODEL_ICONS[config.icon]}
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
                  className="outline-none z-[100000] rounded-2xl shadow-none border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] flex flex-col p-0 overflow-hidden"
                >
                  <div className="relative rounded-2xl flex flex-col overflow-hidden max-w-[344px] max-h-[40rem] w-screen h-screen md:w-auto md:h-auto">
                    {/* Top glow */}
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

                    {/* Bottom glow */}
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

                    {/* Search bar */}
                    <label className="relative z-10 px-3 py-2 flex items-center gap-2 min-h-[41px] h-[41px] border-b border-white/10 cursor-text">
                      <Search className="size-4 text-neutral-500" />
                      <input
                        type="text"
                        placeholder="Search..."
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value.toLowerCase())}
                        className="text-sm flex-1 outline-none bg-transparent text-white placeholder-neutral-500"
                      />
                    </label>

                    {/* Scrollable content */}
                    <div className="relative overflow-hidden min-h-0 flex flex-col flex-1">
                      {/* Top fade gradient */}
                      <div
                        className="absolute z-10 pointer-events-none select-none top-0 left-0 w-full opacity-100 transition-opacity"
                        style={{
                          height: "12px",
                          background: "linear-gradient(rgba(19, 21, 23, 0.898) 0%, rgba(19, 21, 23, 0) 100%)",
                        }}
                      />

                      <div className="hide-scrollbar min-h-0 overflow-y-auto h-full">
                        {/* Featured Models Section */}
                        <div>
                          <div className="flex items-center gap-1.5 px-3 pt-2 pb-2">
                            <span className="text-xs font-medium text-neutral-500 flex-1">Featured models</span>
                          </div>
                          <div className="px-3 flex flex-col gap-1">
                            {FEATURED_MODELS_LIST.filter(
                              (m) =>
                                m.label.toLowerCase().includes(modelSearch) ||
                                m.description.toLowerCase().includes(modelSearch)
                            ).map((model) => (
                              <button
                                key={model.id}
                                onClick={() => handleModelSelect(model.id)}
                                className={`w-full flex gap-0 items-center pl-1.5 py-1.5 pr-3 rounded-xl transition-colors cursor-pointer hover:bg-white/5 focus-visible:bg-white/5 text-start ${
                                  modelParam === model.id ? "bg-white/5" : ""
                                }`}
                              >
                                <div className="size-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mr-2 shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)]">
                                  <span
                                    className={`text-sm font-bold ${
                                      modelParam === model.id ? "text-[#00e5ff]" : "text-neutral-500"
                                    }`}
                                  >
                                    {MODEL_ICONS[model.icon as keyof typeof MODEL_ICONS] || "•"}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col gap-1 items-start">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-medium text-white">{model.label}</span>
                                    {model.badge && (
                                      <span className="font-grotesk text-[10px] inline-block uppercase px-1 rounded-sm font-bold -skew-x-12 h-4 max-h-4 leading-4 flex items-center justify-center bg-amber-400 text-black">
                                        {model.badge}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-neutral-400">{model.description}</span>
                                </div>
                                {modelParam === model.id && (
                                  <div className="size-5 shrink-0 flex items-center justify-center">
                                    <Check className="size-4 text-[#00e5ff]" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* All Models Section */}
                        <div className="mt-2">
                          <div className="flex items-center gap-1.5 px-3 pt-2 pb-2">
                            <span className="text-xs font-medium text-neutral-500 flex-1">All models</span>
                          </div>
                          <div className="px-3 flex flex-col gap-1 pb-4">
                            {ALL_MODELS_LIST.filter(
                              (m) =>
                                m.label.toLowerCase().includes(modelSearch) ||
                                m.description.toLowerCase().includes(modelSearch)
                            ).map((model) => (
                              <button
                                key={model.id}
                                onClick={() => handleModelSelect(model.id)}
                                className={`w-full flex gap-0 items-center pl-1.5 py-1.5 pr-3 rounded-xl transition-colors cursor-pointer hover:bg-white/5 focus-visible:bg-white/5 text-start ${
                                  modelParam === model.id ? "bg-white/5" : ""
                                }`}
                              >
                                <div className="size-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mr-2 shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)]">
                                  <span
                                    className={`text-sm font-bold ${
                                      modelParam === model.id ? "text-[#00e5ff]" : "text-neutral-500"
                                    }`}
                                  >
                                    {MODEL_ICONS[model.icon as keyof typeof MODEL_ICONS] || "•"}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col gap-1 items-start">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-medium text-white">{model.label}</span>
                                    {model.badge && (
                                      <span className="font-grotesk text-[10px] inline-block uppercase px-1 rounded-sm font-bold -skew-x-12 h-4 max-h-4 leading-4 flex items-center justify-center bg-amber-400 text-black">
                                        {model.badge}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-neutral-400">{model.description}</span>
                                </div>
                                {modelParam === model.id && (
                                  <div className="size-5 shrink-0 flex items-center justify-center">
                                    <Check className="size-4 text-[#00e5ff]" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Bottom fade gradient */}
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
                            opt === quality ? "bg-[#00e5ff]/10 text-[#00e5ff]" : "text-neutral-300 hover:bg-[#1e1e1e]"
                          }`}
                        >
                          {opt}
                          {config.premiumQualityOptions?.includes(opt) && (
                            <span className="ml-1 text-[10px] text-[#00e5ff]">Pro</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}

            {/* Aspect Ratio Selector */}
            <Popover.Root open={isAspectOpen} onOpenChange={setIsAspectOpen}>
              <Popover.Trigger asChild>
                <button type="button" className={PILL}>
                  {aspectRatio}
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] bg-transparent">
                  <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[110px] overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0a] p-1 shadow-xl">
                    {config.aspectRatioOptions.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => {
                          setAspectRatio(ratio);
                          setIsAspectOpen(false);
                        }}
                        className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                          ratio === aspectRatio ? "bg-[#00e5ff]/10 text-[#00e5ff]" : "text-neutral-300 hover:bg-[#1e1e1e]"
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

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
        </form>

        {/* Generate Button */}
        <button
          type="submit"
          aria-label="Generate"
          className="relative flex shrink-0 flex-col items-center justify-center gap-1 self-center overflow-hidden rounded-xl border-0 font-bold uppercase text-black transition-all duration-200 ease-out hover:brightness-90 active:brightness-[0.8] focus:outline-none focus:ring-2 focus:ring-[#00e5ff] focus:ring-offset-2 focus:ring-offset-black"
          style={{
            width: 120,
            height: 80,
            background: "linear-gradient(135deg, #CDFF00 0%, #A6D400 100%)",
            boxShadow: "10px 34px 24px 0 rgba(0,0,0,0.15), 8px 21px 6px 0 rgba(0,0,0,0.01), 3px 7px 5px 0 rgba(0,0,0,0.25), 1px 3px 4px 0 rgba(0,0,0,0.43), 0 1px 2px 0 rgba(0,0,0,0.49), inset 0px -3px 0px 0px #829B19, inset 0px -2px 0px 0px #829B19, inset 0px 1px 0px 0px #CDFF00",
            textShadow: "rgba(255,255,255,0.45) 0px 0px 8px",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute left-[39px] top-[36px] h-[136px] w-[76px] rounded-[50%] mix-blend-plus-lighter blur-[41.5px]"
            style={{
              background: "#CDFF00",
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

      <input
        ref={fileInputRef}
        id="image-form-reference"
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp"
        className="sr-only"
      />
    </div>
  );
}

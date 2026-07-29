"use client";

import { useState, useRef, useMemo } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Plus, Heart } from "lucide-react";
import { IMAGE_MODEL_CONFIGS, FEATURED_IMAGE_MODELS, type ImageModelConfig } from "@/lib/imageModelConfig";
import { useRouter, useSearchParams } from "next/navigation";

const MODEL_ICONS: Record<string, string> = {
  openai: "🤖",
  seedream: "🌈",
  google: "G",
};

export default function GenerationComposer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model") || "nano-banana-pro";
  const config = IMAGE_MODEL_CONFIGS[modelParam];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [isAspectOpen, setIsAspectOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedModel, setSelectedModel] = useState(modelParam);

  const [quality, setQuality] = useState(config.defaultQuality);
  const [aspectRatio, setAspectRatio] = useState(config.defaultAspectRatio);
  const [count, setCount] = useState(config.defaultCount);

  const filteredModels = useMemo(() => {
    const allModels = Object.values(IMAGE_MODEL_CONFIGS);
    if (!searchTerm) return allModels;
    return allModels.filter(
      (m) =>
        m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm]);

  if (!config) return null;

  const handleModelSelect = (modelId: string) => {
    const newConfig = IMAGE_MODEL_CONFIGS[modelId];
    setQuality(newConfig.defaultQuality);
    setAspectRatio(newConfig.defaultAspectRatio);
    setCount(newConfig.defaultCount);
    setSelectedModel(modelId);
    setIsModelOpen(false);
    router.push(`/generate/image?model=${modelId}`);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-7xl px-4 z-50">
      <form className="w-full bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Prompt Row */}
        <div className="flex gap-3 p-4 border-b border-neutral-800">
          {config.showUpload && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-12 w-12 shrink-0 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}

          <div className="flex-1 relative">
            <div
              ref={promptRef}
              contentEditable
              suppressContentEditableWarning
              className="w-full px-4 py-3 text-white text-sm leading-relaxed focus:outline-none min-h-12 max-h-24 overflow-y-auto bg-transparent"
              onInput={(e) => {
                const text = (e.currentTarget as HTMLDivElement).innerText;
                setPrompt(text);
              }}
            />
            {!prompt && (
              <p className="absolute top-3 left-4 text-zinc-500 text-sm pointer-events-none">
                Describe the scene you imagine
              </p>
            )}
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3 justify-between">
          <div className="flex gap-3 flex-wrap items-center">

            {/* Model selector */}
            <Popover.Root open={isModelOpen} onOpenChange={setIsModelOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2"
                >
                  {MODEL_ICONS[config.icon] && (
                    <span className="h-6 w-6 flex items-center justify-center bg-white/10 rounded-full text-xs font-bold">
                      {MODEL_ICONS[config.icon]}
                    </span>
                  )}
                  {config.label}
                  <ChevronDown className="h-4 w-4" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  align="start"
                  sideOffset={12}
                  className="z-[100000] w-[344px] max-h-[min(40rem,calc(100vh-32px))] rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] overflow-hidden flex flex-col shadow-xl"
                >
                  <div className="h-[41px] border-b border-white/10 px-3 flex items-center shrink-0">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
                    />
                  </div>

                  <div className="overflow-y-auto flex-1 min-h-0">
                    {!searchTerm && (
                      <>
                        <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500 sticky top-0 bg-[rgba(28,30,32,0.5)] backdrop-blur">
                          Featured
                        </div>
                        {FEATURED_IMAGE_MODELS.map((model) => (
                          <ModelItemButton
                            key={model.id}
                            model={model}
                            isSelected={selectedModel === model.id}
                            onSelect={() => handleModelSelect(model.id)}
                          />
                        ))}
                      </>
                    )}

                    {filteredModels.length > 0 && (
                      <>
                        <div className="px-3 py-2 text-[10px] font-semibold uppercase text-zinc-500 sticky top-0 bg-[rgba(28,30,32,0.5)] backdrop-blur">
                          {searchTerm ? "Results" : "All Models"}
                        </div>
                        {filteredModels.map((model) => (
                          <ModelItemButton
                            key={model.id}
                            model={model}
                            isSelected={selectedModel === model.id}
                            onSelect={() => handleModelSelect(model.id)}
                          />
                        ))}
                      </>
                    )}

                    {filteredModels.length === 0 && searchTerm && (
                      <div className="px-4 py-8 text-center text-xs text-zinc-500">
                        No models found
                      </div>
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            {/* Aspect ratio */}
            {config.aspectRatioOptions.length > 0 && (
              <Popover.Root open={isAspectOpen} onOpenChange={setIsAspectOpen}>
                <Popover.Trigger asChild>
                  <button type="button" className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10">
                    {aspectRatio}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    sideOffset={8}
                    className="z-[100000] w-56 rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-3 px-2 shadow-xl"
                  >
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase text-zinc-400 mb-2">Aspect ratio</div>
                    <div className="flex flex-col gap-1">
                      {(config.aspectRatioOptions || ["1:1", "3:4", "4:3"]).map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => {
                            setAspectRatio(ratio);
                            setIsAspectOpen(false);
                          }}
                          className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between ${
                            aspectRatio === ratio
                              ? "bg-cyan-500/20 text-cyan-300"
                              : "text-white hover:bg-white/5"
                          }`}
                        >
                          {ratio}
                          {aspectRatio === ratio && <span className="text-cyan-400">✓</span>}
                        </button>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}

            {/* Quality */}
            {config.qualityOptions.length > 0 && (
              <Popover.Root open={isQualityOpen} onOpenChange={setIsQualityOpen}>
                <Popover.Trigger asChild>
                  <button type="button" className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10">
                    {quality}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    sideOffset={8}
                    className="z-[100000] w-48 rounded-2xl border border-white/10 bg-[rgba(28,30,32,0.95)] backdrop-blur-[32px] py-3 px-2 shadow-xl"
                  >
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase text-zinc-400 mb-2">Quality</div>
                    <div className="flex flex-col gap-1">
                      {(config.qualityOptions || ["2K", "3K", "4K"]).map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            setQuality(q);
                            setIsQualityOpen(false);
                          }}
                          className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors flex items-center justify-between ${
                            quality === q
                              ? "bg-cyan-500/20 text-cyan-300"
                              : "text-white hover:bg-white/5"
                          }`}
                        >
                          {q}
                          {quality === q && <span className="text-cyan-400">✓</span>}
                        </button>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}

            {/* Heart/Favorites */}
            <button type="button" className="h-10 w-10 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors">
              <Heart className="h-4 w-4" />
            </button>

            {/* Quantity */}
            {config.maxCount > 1 && (
              <div className="h-10 flex items-center gap-1 px-3 rounded-xl border border-white/10 bg-white/5">
                <button
                  type="button"
                  onClick={() => setCount(Math.max(1, count - 1))}
                  disabled={count <= 1}
                  className="text-white text-sm font-bold hover:text-cyan-400 disabled:opacity-40"
                >
                  −
                </button>
                <span className="text-white text-xs font-bold px-1">
                  {count}
                  <span className="text-zinc-500">/{config.maxCount || 4}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCount(Math.min(config.maxCount || 4, count + 1))}
                  disabled={count >= (config.maxCount || 4)}
                  className="text-white text-sm font-bold hover:text-cyan-400 disabled:opacity-40"
                >
                  +
                </button>
              </div>
            )}

            {/* Draw button */}
            {config.showDraw && (
              <button
                type="button"
                className="h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                ✏️ Draw
              </button>
            )}
          </div>

          <button
            type="submit"
            className="h-10 px-6 rounded-xl bg-[#D97757] text-black font-semibold hover:bg-[#e08a6c] transition-colors text-sm"
          >
            Generate
          </button>
        </div>
      </form>
    </div>
  );
}

// Model item button component
function ModelItemButton({
  model,
  isSelected,
  onSelect,
}: {
  model: ImageModelConfig;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-1.5 py-1.5 pr-3 transition-colors hover:bg-white/5 text-left rounded-xl ${
        isSelected ? "bg-white/5" : ""
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
        <div className="text-xs font-bold text-white/60">★</div>
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="model-title">
          {model.label}
        </h4>
        <p className="text-[10px] text-zinc-500 truncate">{model.description}</p>
      </div>

      {isSelected && (
        <div className="text-sm font-bold text-cyan-400 shrink-0">✓</div>
      )}
    </button>
  );
}

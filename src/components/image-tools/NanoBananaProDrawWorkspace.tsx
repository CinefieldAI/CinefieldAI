"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { X, Info, Trash2, Check } from "lucide-react";

type DrawMode = "sketch-to-video" | "draw-to-video" | "draw-to-edit";
type DrawTool = "select" | "brush" | "eraser" | "rectangle" | "arrow" | "text" | "image" | "undo" | "redo";
type AspectRatio = "Auto" | "1:1" | "3:4" | "4:3" | "2:3" | "3:2" | "9:16" | "16:9" | "5:4" | "4:5" | "21:9";
type ModelId = "gpt-image-2" | "seedream-4-5" | "nano-banana-pro" | "nano-banana-2" | "nano-banana-2-lite";

const DRAW_COLORS = ["rgba(222,222,222,1)", "rgba(55,214,76,1)", "rgba(255,179,14,1)", "rgba(44,69,255,1)", "rgba(255,51,54,1)"];
const DRAW_TOOLS: DrawTool[] = ["select", "brush", "eraser", "rectangle", "arrow", "text", "image", "undo", "redo"];

interface ImageModel {
  id: ModelId;
  label: string;
  description: string;
  icon: string;
  quality?: string[];
  thinking?: string[];
  hasDraw: boolean;
}

const IMAGE_MODELS: ImageModel[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    description: "4K images with near-perfect text rendering",
    icon: "🤖",
    quality: ["Low", "Medium", "High"],
    hasDraw: false,
  },
  {
    id: "seedream-4-5",
    label: "Seedream 4.5",
    description: "ByteDance's next-gen 4K image model",
    icon: "🌈",
    quality: ["2K", "4K"],
    hasDraw: false,
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    description: "Google's flagship generation model",
    icon: "G",
    quality: ["1K", "2K", "4K Premium"],
    hasDraw: true,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    description: "Google image generation model",
    icon: "G",
    quality: ["1K", "2K", "4K Premium"],
    hasDraw: false,
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    description: "Fast Google image generation model",
    icon: "G",
    thinking: ["High", "Minimal"],
    hasDraw: false,
  },
];

const ASPECT_RATIOS: AspectRatio[] = ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"];

const TOOL_ICONS: Record<DrawTool, string> = {
  select: "→",
  brush: "🖌️",
  eraser: "🧹",
  rectangle: "▭",
  arrow: "→",
  text: "T",
  image: "🖼️",
  undo: "↶",
  redo: "↷",
};

function getAspectRatioValue(ratio: AspectRatio): number {
  const map: Record<AspectRatio, number> = {
    "Auto": 16 / 9,
    "1:1": 1,
    "3:4": 0.75,
    "4:3": 1.333,
    "2:3": 0.667,
    "3:2": 1.5,
    "9:16": 0.5625,
    "16:9": 1.777,
    "5:4": 1.25,
    "4:5": 0.8,
    "21:9": 2.333,
  };
  return map[ratio] || 1.777;
}

export default function NanoBananaProDrawWorkspace({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [drawMode, setDrawMode] = useState<DrawMode>("draw-to-edit");
  const [selectedTool, setSelectedTool] = useState<DrawTool>("text");
  const [drawColor, setDrawColor] = useState("rgba(255,51,54,1)");
  const [drawAspectRatio, setDrawAspectRatio] = useState<AspectRatio>("16:9");
  const [selectedModel, setSelectedModel] = useState<ModelId>("nano-banana-pro");
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  const currentModel = IMAGE_MODELS.find((m) => m.id === selectedModel) || IMAGE_MODELS[2];

  if (!isOpen) return null;

  const aspectValue = getAspectRatioValue(drawAspectRatio);

  return (
    // Root dialog - matches the exact hierarchy from HTML
    <div
      className="fixed inset-0 z-[1000] h-full w-full xl:w-11/12 mx-auto md:px-4 grid items-center outline-none bg-black/80 backdrop-blur-sm"
      role="dialog"
      data-state="open"
    >
      <h2 className="sr-only">Draw To Edit</h2>

      {/* Inner editor panel */}
      <div className="grid grid-rows-[auto_1fr_auto] md:grid-rows-[1fr_auto] gap-4 z-50 p-4 w-full h-full md:h-10/12 items-center md:border border-white/15 bg-neutral-900 animate-in fade-in duration-300 md:rounded-3xl relative">

        {/* Content grid */}
        <div className="grid grid-rows-[auto_1fr_auto] gap-3 size-full overflow-hidden">

          {/* Top: Mode Selector */}
          <div className="flex gap-1 p-0.5 px-1 rounded-full outline outline-offset-[-1px] outline-surface-secondary bg-surface-primary w-fit mx-auto" role="group" aria-label="Drawing type">
            {[
              { value: "sketch-to-video" as DrawMode, label: "Sketch to Video", isNew: true },
              { value: "draw-to-video" as DrawMode, label: "Draw to Video", isNew: false },
              { value: "draw-to-edit" as DrawMode, label: "Draw to Edit", isNew: false },
            ].map((mode) => (
              <button
                key={mode.value}
                onClick={() => setDrawMode(mode.value)}
                className={`rounded-full py-1.5 px-3 flex gap-1 items-center justify-center text-xs font-medium duration-200 outline outline-offset-[-1px] transition-all ${
                  drawMode === mode.value
                    ? "bg-surface-secondary text-white !outline-[#353738]"
                    : "text-[#898A8B] outline-surface-primary hover:text-white/60"
                }`}
              >
                <span>{mode.label}</span>
                {mode.isNew && <span className="text-[9px] bg-[#00e5ff]/20 text-[#00e5ff] px-1.5 py-0.5 rounded-full font-semibold">NEW</span>}
              </button>
            ))}
          </div>

          {/* Center: Canvas */}
          <div className="size-full relative overflow-hidden rounded-xl bg-neutral-background">
            <div className="relative flex h-full w-full items-center justify-center select-none">
              <div>
                <div
                  className="konvajs-content"
                  role="presentation"
                  style={{
                    position: "relative",
                    userSelect: "none",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  {/* Canvas surface with aspect ratio */}
                  <div
                    className="relative bg-white rounded-sm overflow-hidden shadow-2xl mx-auto"
                    style={{
                      aspectRatio: aspectValue,
                      maxHeight: "100%",
                      maxWidth: "100%",
                    }}
                  >
                    <canvas className="absolute inset-0 w-full h-full" />
                  </div>
                </div>
              </div>

              {/* Hidden textarea for text tool */}
              <textarea
                className="absolute z-10 outline-none resize-none size-0"
                style={{
                  color: "rgb(255, 51, 54)",
                  fontSize: "20px",
                  fontFamily: "Inter",
                  fontWeight: "600",
                }}
              />
            </div>
          </div>

          {/* Bottom: Controls */}
          <div className="text-white w-full relative flex items-center justify-between gap-3">

            {/* Bottom-left: Model Selector + Settings */}
            <div className="flex items-center gap-2">
              <Popover.Root open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
                <Popover.Trigger asChild>
                  <button className="flex items-center justify-center h-10 rounded-lg bg-neutral-800 border border-neutral-700 px-3 text-white text-sm font-medium hover:bg-neutral-700 transition-colors">
                    {currentModel.icon} {currentModel.label}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="start" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
                    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden flex flex-col w-80">
                      {/* Title */}
                      <div className="px-4 py-3 border-b border-neutral-700 bg-neutral-900">
                        <div className="text-sm font-medium text-neutral-400">Models</div>
                      </div>

                      {/* Model Rows */}
                      <div className="overflow-y-auto flex flex-col">
                        {IMAGE_MODELS.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setSelectedModel(model.id);
                              setIsModelPickerOpen(false);
                            }}
                            className={`w-full flex gap-0 items-center pl-1.5 py-1.5 pr-3 rounded-xl transition-colors cursor-pointer hover:bg-white/5 focus-visible:bg-white/5 text-start ${
                              selectedModel === model.id ? "bg-white/5" : ""
                            }`}
                          >
                            {/* Icon box */}
                            <div className="size-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mr-2 text-sm font-medium">
                              {model.icon}
                            </div>

                            {/* Text column */}
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="model-title">{model.label}</div>
                              <div className="text-[10px] text-white/50 truncate">{model.description}</div>
                            </div>

                            {/* Check icon */}
                            {selectedModel === model.id && (
                              <Check className="size-4 text-white/70 flex-shrink-0 ml-2" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              <button className="flex items-center justify-center h-10 rounded-lg bg-neutral-800 border border-neutral-700 px-3 text-white text-lg hover:bg-neutral-700 transition-colors" title="Settings">
                ⚙️
              </button>
            </div>

            {/* Center: Toolbar */}
            <div className="flex items-center gap-0.5 px-1 rounded-xl bg-[rgba(28,28,28,0.9)] border border-[rgba(38,38,38,1)] flex-1">
              {DRAW_TOOLS.map((tool) => (
                <button
                  key={tool}
                  onClick={() => setSelectedTool(tool)}
                  className={`flex size-10 md:size-8 items-center justify-center rounded-lg border border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed md:[&_svg]:size-4 ${
                    selectedTool === tool
                      ? "bg-white text-black"
                      : "text-white hover:bg-white hover:bg-opacity-10"
                  }`}
                  title={tool.charAt(0).toUpperCase() + tool.slice(1)}
                >
                  <span className="text-base">{TOOL_ICONS[tool]}</span>
                </button>
              ))}

              {/* Color picker inline */}
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    className="flex size-10 md:size-8 items-center justify-center rounded-lg border-2 border-[rgba(255,255,255,0.24)] hover:border-[rgba(255,255,255,0.5)] transition-colors ml-0.5"
                    style={{ background: drawColor }}
                    title="Color"
                  />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
                    <div className="rounded-2xl border border-[rgba(38,38,38,1)] bg-[rgba(28,28,28,0.9)] flex items-center gap-2 p-2">
                      {DRAW_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setDrawColor(c)}
                          className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${
                            drawColor === c
                              ? "border-2 border-white scale-110"
                              : "border border-transparent hover:border-white/50"
                          }`}
                        >
                          <div className="w-3 h-3 rounded-full" style={{ background: c }} />
                        </button>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>

            {/* Center-right: Generate button (compact) */}
            <button className="flex items-center justify-center gap-2 h-10 rounded-lg bg-[#D97757] text-black font-semibold text-sm px-3 hover:brightness-90 transition-all whitespace-nowrap">
              <span>✨</span>
              <span>Generate Image</span>
              <span className="text-xs font-bold">+1</span>
            </button>

            {/* Bottom-right: Aspect Ratio, Trash, Info */}
            <div className="flex items-center gap-2">
              {/* Aspect Ratio - Only ONE trigger */}
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className="flex items-center justify-center h-10 rounded-lg bg-neutral-800 border border-neutral-700 px-3 text-white text-sm font-medium hover:bg-neutral-700 transition-colors">
                    {drawAspectRatio}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="end" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
                    <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden flex flex-col max-h-96 w-64">
                      {/* Title */}
                      <div className="px-4 py-3 border-b border-neutral-700 bg-neutral-900">
                        <div className="text-sm font-medium text-neutral-400">Aspect ratio</div>
                      </div>

                      {/* Options with checkboxes */}
                      <div className="overflow-y-auto flex flex-col p-2 gap-0.5">
                        {ASPECT_RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            onClick={() => setDrawAspectRatio(ratio)}
                            className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 rounded-md transition-colors text-white/70 hover:text-white/90 hover:bg-neutral-800"
                          >
                            {/* Checkbox */}
                            <div className="w-5 h-5 border border-neutral-600 rounded-sm flex items-center justify-center flex-shrink-0">
                              {drawAspectRatio === ratio && <span className="text-white text-xs">✓</span>}
                            </div>
                            <span className="flex-1">{ratio}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Trash button */}
              <button className="flex items-center justify-center h-10 rounded-lg bg-neutral-800 border border-neutral-700 px-3 text-white hover:bg-neutral-700 transition-colors" title="Delete">
                <Trash2 className="size-4" />
              </button>

              {/* Info button */}
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className="flex items-center justify-center h-10 rounded-lg bg-neutral-800 border border-neutral-700 px-3 text-white hover:bg-neutral-700 transition-colors" title="Info">
                    <Info className="size-4" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="top" align="end" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
                    <figure
                      className="px-4 py-3 rounded-xl w-[300px] flex flex-col gap-3"
                      style={{
                        background: "rgba(27, 27, 27, 0.64)",
                        backdropFilter: "blur(32px)",
                        border: "1px solid rgb(38, 38, 38)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <figcaption className="text-sm font-semibold text-white">Example usage</figcaption>
                        <button type="button" className="text-white/60 hover:text-white transition-colors">
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "1.335" }}>
                        <video
                          poster="https://static.higgsfield.ai/racer_veo_4x3_3.webp"
                          src="https://static.higgsfield.ai/racer_veo_4x3_3.mp4"
                          loop
                          playsInline
                          disablePictureInPicture
                          className="object-cover size-full"
                        />
                      </div>
                    </figure>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          </div>
        </div>

        {/* Close button - positioned absolutely on right */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 xl:top-0 xl:-right-[3.5rem] flex items-center justify-center h-10 w-10 rounded-lg hover:bg-white/10 transition-colors"
          title="Close"
        >
          <X className="size-5 text-white" />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { X, Info } from "lucide-react";

type DrawMode = "sketch-to-video" | "draw-to-video" | "draw-to-edit";
type DrawTool = "select" | "brush" | "eraser" | "rectangle" | "arrow" | "text" | "image" | "undo" | "redo";
type AspectRatio = "Auto" | "1:1" | "3:4" | "4:3" | "2:3" | "3:2" | "9:16" | "16:9" | "5:4" | "4:5" | "21:9";

const DRAW_COLORS = [
  "rgba(222,222,222,1)",
  "rgba(55,214,76,1)",
  "rgba(255,179,14,1)",
  "rgba(44,69,255,1)",
  "rgba(255,51,54,1)",
];

const ASPECT_RATIOS: AspectRatio[] = ["Auto", "1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "5:4", "4:5", "21:9"];

const DRAW_TOOLS: DrawTool[] = ["select", "brush", "eraser", "rectangle", "arrow", "text", "image", "undo", "redo"];

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

function ModeSelector({ mode, onChange }: { mode: DrawMode; onChange: (m: DrawMode) => void }) {
  return (
    <div className="flex gap-2 justify-center items-center">
      {[
        { value: "sketch-to-video", label: "Sketch to Video", icon: "✏️", isNew: true },
        { value: "draw-to-video", label: "Draw to Video", icon: "✨", isNew: false },
        { value: "draw-to-edit", label: "Draw to Edit", icon: "🖼️", isNew: false },
      ].map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value as DrawMode)}
          className={`rounded-full py-3 px-4 flex gap-2 items-center justify-center text-sm font-medium duration-200 outline outline-offset-[-1px] transition-all ${
            mode === item.value
              ? "bg-surface-secondary text-white outline-[#353738]"
              : "text-[#898A8B] outline-surface-primary hover:text-white/60"
          }`}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
          {item.isNew && (
            <span className="text-[10px] bg-[#00e5ff]/20 text-[#00e5ff] px-2 py-0.5 rounded-full font-semibold">NEW</span>
          )}
        </button>
      ))}
    </div>
  );
}

function AspectRatioPopover({
  aspectRatio,
  onChange,
}: {
  aspectRatio: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Aspect ratio"
          aria-haspopup="listbox"
          className="flex items-center justify-center h-[42px] rounded-xl bg-[rgba(28,28,28,0.9)] border border-[rgba(38,38,38,1)] px-3 text-white text-sm font-medium hover:bg-[rgba(38,38,38,0.9)] transition-colors"
        >
          {aspectRatio}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent p-0">
          <div
            className="w-56 rounded-xl border border-primary-5 bg-modal-default overflow-hidden flex flex-col"
            role="listbox"
            aria-label="Select aspect ratio"
          >
            {/* Title strip */}
            <div className="sticky top-0 px-3 py-2.5 border-b border-primary-5 bg-modal-default text-white-60 text-caption-l font-medium">
              Aspect ratio
            </div>

            {/* Options */}
            <div className="overflow-y-auto flex flex-col p-1">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  role="option"
                  aria-selected={aspectRatio === ratio}
                  onClick={() => {
                    onChange(ratio);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-1.5 py-1.5 text-caption-l flex items-center justify-between rounded-md transition-colors ${
                    aspectRatio === ratio
                      ? "bg-overlay-active-normal text-white"
                      : "text-white/90 hover:bg-overlay-active-normal"
                  }`}
                >
                  <span>{ratio}</span>
                  {aspectRatio === ratio && <span className="text-[#00e5ff] text-sm">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SettingsPopover({
  duration,
  setDuration,
  resolution,
  setResolution,
}: {
  duration: string;
  setDuration: (d: string) => void;
  resolution: string;
  setResolution: (r: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-[42px] rounded-xl bg-[rgba(28,28,28,0.9)] border border-[rgba(38,38,38,1)] px-3 text-white text-xl hover:bg-[rgba(38,38,38,0.9)] transition-colors"
        >
          ⚙️
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
          <div className="rounded-xl shadow-xl border border-primary-5 bg-modal-default py-3 px-4 flex flex-col gap-4 text-white w-72">
            {/* Duration */}
            <div>
              <label className="text-xs font-semibold mb-2 block text-white/60">Duration</label>
              <div className="flex gap-2">
                {["5s", "10s"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDuration(opt)}
                    className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                      duration === opt
                        ? "bg-white text-black"
                        : "bg-transparent text-white hover:bg-neutral-surface-subtle"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div>
              <label className="text-xs font-semibold mb-2 block text-white/60">Resolution</label>
              <div className="flex gap-2">
                {["480p", "720p", "1080p"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setResolution(opt)}
                    className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                      resolution === opt
                        ? "bg-white text-black"
                        : "bg-transparent text-white hover:bg-neutral-surface-subtle"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ColorPickerPopover({
  color,
  onChange,
}: {
  color: string;
  onChange: (c: string) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Draw color"
          className="flex size-10 md:size-8 items-center justify-center rounded-lg border-2 border-[rgba(255,255,255,0.24)] hover:border-[rgba(255,255,255,0.5)] transition-colors"
          style={{ background: color }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
          <div className="rounded-2xl border border-[rgba(38,38,38,1)] bg-[rgba(28,28,28,0.9)] flex items-center gap-2 p-2">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${
                  color === c
                    ? "border-2 border-white scale-110"
                    : "border border-transparent hover:border-white/50"
                }`}
                title={c}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ background: c }}
                />
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function InfoPopover() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Example usage"
          className="flex items-center justify-center size-[42px] rounded-xl bg-[rgba(28,28,28,0.9)] border border-[rgb(38,38,38)] hover:bg-[rgba(38,38,38,0.9)] transition-colors"
        >
          <Info className="size-5 text-white" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} className="z-[100000] outline-none border-none bg-transparent">
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
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-white/60 hover:text-white transition-colors"
              >
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
  );
}

export default function NanoBananaProDrawPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [drawMode, setDrawMode] = useState<DrawMode>("draw-to-video");
  const [selectedTool, setSelectedTool] = useState<DrawTool>("select");
  const [drawColor, setDrawColor] = useState("rgba(255,51,54,1)");
  const [duration, setDuration] = useState("5s");
  const [resolution, setResolution] = useState("720p");
  const [drawAspectRatio, setDrawAspectRatio] = useState<AspectRatio>("9:16");

  if (!isOpen) return null;

  const aspectValue = getAspectRatioValue(drawAspectRatio);

  return (
    // Fixed overlay backdrop
    <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm text-white flex items-center justify-center p-4">
      {/* Main Draw Workspace */}
      <div className="relative w-full h-full max-w-7xl max-h-[90vh] bg-[#0a0a0a] rounded-2xl border border-white/10 overflow-hidden flex flex-col">

        {/* Top: Mode Selector */}
        <div className="flex items-center justify-center px-6 py-6 border-b border-white/10">
          <ModeSelector mode={drawMode} onChange={setDrawMode} />
        </div>

        {/* Middle: Canvas Area */}
        <div className="flex-1 overflow-hidden p-8 flex items-center justify-center relative">
          {/* Canvas Surface */}
          <div
            className="relative rounded-xl overflow-hidden bg-white shadow-2xl flex items-center justify-center"
            style={{
              aspectRatio: aspectValue,
              maxHeight: "100%",
              maxWidth: "100%",
            }}
          >
            {/* Simulated Konva layers */}
            <div className="absolute inset-0">
              <canvas className="absolute inset-0 w-full h-full" />
            </div>
            <div className="absolute inset-0 konvajs-content pointer-events-none" />

            {/* Hidden textarea for text tool */}
            <textarea
              className="absolute z-10 outline-none resize-none size-0 opacity-0"
              style={{
                color: "rgb(255, 51, 54)",
                fontSize: "20px",
                fontFamily: "Inter",
                fontWeight: "600",
              }}
            />

            {/* Placeholder text */}
            <div className="text-gray-400 text-sm pointer-events-none text-center px-8">
              <div className="text-lg font-medium mb-2">🎨 Draw Canvas</div>
              <div className="text-xs">Ready to draw - {drawMode}</div>
            </div>
          </div>

          {/* Floating Toolbar - Bottom Center of Canvas */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1 rounded-xl bg-[rgba(28,28,28,0.9)] border border-[rgba(38,38,38,1)] z-50">
            {DRAW_TOOLS.map((tool) => {
              const toolIcons: Record<DrawTool, string> = {
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

              return (
                <button
                  key={tool}
                  type="button"
                  onClick={() => setSelectedTool(tool)}
                  className={`flex size-10 md:size-8 items-center justify-center rounded-lg border border-transparent transition-colors md:[&_svg]:size-4 ${
                    selectedTool === tool
                      ? "bg-white text-black"
                      : "text-white hover:bg-white hover:bg-opacity-10"
                  }`}
                  title={tool.charAt(0).toUpperCase() + tool.slice(1)}
                >
                  <span className="text-base">{toolIcons[tool]}</span>
                </button>
              );
            })}
          </div>

          {/* Floating Controls - Right Side */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-50">
            {/* Aspect Ratio */}
            <AspectRatioPopover aspectRatio={drawAspectRatio} onChange={setDrawAspectRatio} />

            {/* Settings */}
            <SettingsPopover
              duration={duration}
              setDuration={setDuration}
              resolution={resolution}
              setResolution={setResolution}
            />

            {/* Color Picker */}
            <ColorPickerPopover color={drawColor} onChange={setDrawColor} />

            {/* Info */}
            <InfoPopover />
          </div>
        </div>

        {/* Bottom: Action Buttons */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-10 rounded-xl bg-neutral-surface-subtle hover:bg-neutral-surface transition-colors px-4"
            title="Close"
          >
            <X className="size-4 text-white" />
          </button>
          <button
            type="submit"
            className="flex items-center justify-center gap-2 h-10 rounded-xl bg-[#CDFF00] text-black font-semibold text-caption-l min-w-36 lg:min-w-44 hover:brightness-90 transition-all"
          >
            <span>✨</span>
            <span className="hidden sm:inline">Generate Image</span>
            <span className="sm:hidden">Generate</span>
            <span className="text-xs font-bold">1</span>
          </button>
        </div>
      </div>
    </div>
  );
}

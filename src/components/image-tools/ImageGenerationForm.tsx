"use client";

import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus, Sparkles, ChevronDown } from "lucide-react";
import ModelSelectorPopover from "./ModelSelectorPopover";

interface ImageGenerationFormProps {
  selectedModel: string;
}

export default function ImageGenerationForm({
  selectedModel,
}: ImageGenerationFormProps) {
  const [prompt, setPrompt] = useState("");
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [resolution, setResolution] = useState("2k");
  const [magic, setMagic] = useState(false);
  const [count, setCount] = useState(4);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const handleAddImage = () => {
    fileInputRef.current?.click();
  };

  const handleGenerate = () => {
    console.log("Generate:", {
      prompt,
      selectedModel,
      aspectRatio,
      resolution,
      magic,
      count,
    });
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-[min(calc(100vw-32px),70rem)] z-50">
      {/* Outer wrapper with gradient border effect */}
      <div className="rounded-[26px] p-0.5 bg-gradient-to-r from-white/5 to-white/5">
        {/* Form container */}
        <div className="w-full p-6 border border-white/10 rounded-3xl backdrop-blur-xl bg-black/80">
          <div className="flex gap-4">
            {/* Left: Prompt area */}
            <div className="flex-1 flex flex-col gap-3">
              {/* Plus button + Prompt input */}
              <div className="flex gap-2">
                <button
                  onClick={handleAddImage}
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
                  title="Add image"
                >
                  <Plus className="h-5 w-5" />
                </button>

                <div className="flex-1 relative">
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    spellCheck="true"
                    className="w-full min-h-10 max-h-20 p-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/20 focus:bg-white/10 resize-none overflow-y-auto whitespace-pre-wrap word-break break-word"
                    onInput={(e) => {
                      const text = (e.currentTarget as HTMLDivElement).innerText;
                      setPrompt(text);
                    }}
                  />
                  {!prompt && (
                    <p className="absolute top-2.5 left-2.5 text-zinc-500 text-sm pointer-events-none select-none">
                      Describe a scene, character, mood, or style...
                    </p>
                  )}
                </div>
              </div>

              {/* Control row */}
              <div className="flex items-center gap-2 h-9 flex-wrap">
                {/* Model selector */}
                <Popover.Root open={isModelOpen} onOpenChange={setIsModelOpen}>
                  <Popover.Trigger asChild>
                    <button className="h-9 px-3 rounded-lg border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2">
                      <span className="truncate max-w-[120px]">
                        {selectedModel === "nano-banana-pro"
                          ? "Nano Banana Pro"
                          : "Create Image"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </button>
                  </Popover.Trigger>
                  <ModelSelectorPopover
                    selectedModel={selectedModel}
                    onClose={() => setIsModelOpen(false)}
                  />
                </Popover.Root>

                {/* Aspect ratio */}
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <option value="1:1">1:1</option>
                  <option value="3:4">3:4</option>
                  <option value="4:3">4:3</option>
                  <option value="16:9">16:9</option>
                </select>

                {/* Resolution */}
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-white/10 bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <option value="1k">1K</option>
                  <option value="2k">2K</option>
                  <option value="4k">4K</option>
                </select>

                {/* Magic button */}
                <button
                  onClick={() => setMagic(!magic)}
                  className={`h-9 px-3 rounded-lg border transition-colors font-medium text-sm flex items-center gap-2 ${
                    magic
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                  {magic ? "On" : "Off"}
                </button>

                {/* Count control */}
                <div className="flex items-center border border-white/10 rounded-lg bg-white/5 h-9">
                  <button
                    onClick={() => setCount(Math.max(1, count - 1))}
                    className="px-2 text-white hover:bg-white/10 transition-colors"
                  >
                    −
                  </button>
                  <span className="px-2 text-sm font-medium text-white min-w-[40px] text-center">
                    {count}/4
                  </span>
                  <button
                    onClick={() => setCount(Math.min(4, count + 1))}
                    className="px-2 text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                    disabled={count >= 4}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Character + Style + Generate */}
            <div className="flex flex-col gap-2 items-end">
              {/* Character tile */}
              <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center relative group cursor-pointer hover:from-zinc-600 hover:to-zinc-800 transition-colors">
                <Plus className="h-6 w-6 text-white opacity-60 group-hover:opacity-100" />
                <span className="absolute bottom-1 left-1 text-[10px] font-bold text-zinc-400">
                  CHARACTER
                </span>
              </div>

              {/* Style tile */}
              <div className="w-36 h-20 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 overflow-hidden relative group cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center">
                <span className="text-sm font-medium text-white">General</span>
                <button className="absolute top-2 right-2 text-xs font-semibold text-white bg-black/40 hover:bg-black/60 px-2 py-1 rounded transition-colors">
                  Change
                </button>
              </div>
            </div>
          </div>

          {/* Generate button - full width at bottom right */}
          <div className="flex justify-end mt-4">
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="h-12 px-8 rounded-lg bg-[#D97757] hover:bg-[#e08a6c] disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-sm flex items-center gap-2 transition-all hover:shadow-lg hover:shadow-[#D97757]/30"
            >
              <Sparkles className="h-4 w-4" />
              Generate
              <span className="ml-1 text-xs font-normal">+2</span>
            </button>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        id="image-form-reference"
        accept=".jpg,.jpeg,.png,.webp"
        className="hidden"
      />
    </div>
  );
}

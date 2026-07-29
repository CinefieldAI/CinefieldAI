"use client";

import { useState } from "react";
import { Send, ChevronDown } from "lucide-react";
import ImageModelDropdown from "./ImageModelDropdown";

const TOOL_PROMPTS: Record<string, string> = {
  "create-image": "Describe the image you want to create...",
  "nano-banana-pro": "Describe your vision in Nano Banana Pro style...",
  "seedream-5-lite": "Describe your image for Seedream 5.0...",
  "character-consistency": "Describe the character and scene...",
  "face-swap": "Upload a face and describe the scene...",
  "character-swap": "Describe the character and scenario...",
  "upscale": "Upload an image to enhance and upscale...",
  "image-prompt": "Upload an image to analyze and generate prompts...",
  "multi-reference": "Describe your editing instructions...",
  "gpt-image": "Describe what you imagine...",
  "flux-2-pro": "Describe your image in detail for FLUX.2...",
  "recraft-v4-1": "Describe your vision for Recraft V4.1...",
};

interface ImageComposerProps {
  selectedTool: string | null;
  toolName: string;
  onToolSelect: (tool: string) => void;
  onGenerate?: (prompt: string) => void;
}

export default function ImageComposer({
  selectedTool,
  toolName,
  onToolSelect,
  onGenerate,
}: ImageComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toolKey = selectedTool || "create-image";
  const placeholder = TOOL_PROMPTS[toolKey] || TOOL_PROMPTS["create-image"];

  const handleGenerate = () => {
    if (prompt.trim()) {
      onGenerate?.(prompt);
    }
  };

  return (
    <div className="border-t border-white/10 bg-black/80 backdrop-blur-md">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="space-y-4">
          {/* Prompt textarea */}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) {
                handleGenerate();
              }
            }}
            className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-magenta-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-magenta-500/30"
            rows={4}
          />

          {/* Bottom controls */}
          <div className="flex items-center justify-between gap-4">
            {/* Model selector button */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span>{toolName}</span>
                <ChevronDown className="h-4 w-4" />
              </button>

              {/* Model dropdown */}
              {dropdownOpen && (
                <>
                  <ImageModelDropdown
                    selectedTool={selectedTool || "create-image"}
                    onSelect={(tool) => {
                      onToolSelect(tool);
                      setDropdownOpen(false);
                    }}
                  />
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDropdownOpen(false)}
                    aria-hidden="true"
                  />
                </>
              )}
            </div>

            <p className="text-xs text-zinc-500">
              Press Ctrl+Enter to generate
            </p>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="flex items-center gap-2 rounded-xl bg-[#D97757] px-6 py-2.5 font-medium text-black transition-all hover:bg-[#e08a6c] hover:shadow-lg hover:shadow-[#D97757]/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#D97757] disabled:hover:shadow-none"
            >
              <span>Generate</span>
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import * as Popover from "@radix-ui/react-popover";
import { Settings2 } from "lucide-react";

interface KlingAdvancedSettingsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  advancedPrompt: string;
  onPromptChange: (value: string) => void;
  orientation: "video" | "image";
  onOrientationChange: (value: "video" | "image") => void;
  portalContainer?: HTMLElement | null;
}

const PILL =
  "flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-medium text-white transition-all duration-200 ease-out hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#00e5ff]";

export default function KlingAdvancedSettingsPanel({
  isOpen,
  onOpenChange,
  advancedPrompt,
  onPromptChange,
  orientation,
  onOrientationChange,
  portalContainer,
}: KlingAdvancedSettingsPanelProps) {
  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Advanced Settings"
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            isOpen
              ? "border-[#D97757] bg-[rgba(17,17,18,0.98)] shadow-[0_0_12px_rgba(217,119,87,0.40)]"
              : "border-white/15 bg-[rgba(18,19,21,0.95)] hover:border-white/30 hover:bg-[rgba(26,28,31,0.98)]"
          }`}
        >
          <Settings2 className="size-3.5 text-neutral-400" />
          Advanced Settings
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-[100000] rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-4 w-[360px] pointer-events-auto"
        >
          <div className="space-y-4">
            {/* Header */}
            <div className="text-sm font-semibold text-white">Advanced Settings</div>

            {/* Prompt Textarea */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-400">Prompt</label>
              <textarea
                value={advancedPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Describe the scene you imagine, with details."
                className="w-full h-24 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-[#00e5ff] focus:border-transparent resize-none"
              />
            </div>

            {/* Orientation */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-400">Orientation</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOrientationChange("video")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    orientation === "video"
                      ? "bg-[#00e5ff] text-[#0a0a0a]"
                      : "bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.1)]"
                  }`}
                >
                  Video
                </button>
                <button
                  type="button"
                  onClick={() => onOrientationChange("image")}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    orientation === "image"
                      ? "bg-[#00e5ff] text-[#0a0a0a]"
                      : "bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.1)]"
                  }`}
                >
                  Image
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                When Character Orientation matches the video, complex motions perform better; when it matches the image, camera movements are better supported.
              </p>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

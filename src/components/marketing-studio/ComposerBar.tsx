"use client";

import { Plus, ChevronDown, Settings } from "lucide-react";
import { UploadedMedia } from "./MediaAttachPanel";
import { HookItem } from "./HookPanel";
import { SettingItem } from "./SettingPanel";

interface ComposerBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedTarget: "product" | "app";
  onProductClick: () => void;
  onAppClick: () => void;
  selectedMode: "UGC" | "Mobile" | "Settings";
  onUgcClick: () => void;
  onHookClick: () => void;
  onSettingClick: () => void;
  onMediaAttachClick: () => void;
  onOptionsClick: () => void;
  selectedHook: HookItem | null;
  selectedSetting: SettingItem | null;
  activeFloatingPanel: string | null;
  optionsButtonRef: React.RefObject<HTMLButtonElement | null>;
  attachedProductMedia: UploadedMedia[];
  onProductCardClick: () => void;
  onAvatarCardClick: () => void;
  onGenerate: () => void;
  isSticky?: boolean;
}

export default function ComposerBar({
  prompt,
  onPromptChange,
  selectedTarget,
  onProductClick,
  onAppClick,
  selectedMode,
  onUgcClick,
  onHookClick,
  onSettingClick,
  onMediaAttachClick,
  onOptionsClick,
  selectedHook,
  selectedSetting,
  activeFloatingPanel,
  optionsButtonRef,
  attachedProductMedia,
  onProductCardClick,
  onAvatarCardClick,
  onGenerate,
}: ComposerBarProps) {
  return (
    <div className="mx-auto flex w-[min(980px,calc(100vw-32px))] items-stretch gap-2">
      {/* LEFT PRODUCT/APP SELECTOR */}
      <div className="h-[116px] w-[70px] rounded-[22px] bg-[#23252b] border border-white/10 p-1 flex flex-col gap-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
        <button
          onClick={onProductClick}
          className={`flex-1 rounded-[18px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
            selectedTarget === "product"
              ? "bg-[#3a3d45] text-white"
              : "text-white/55 hover:text-white hover:bg-white/5"
          }`}
        >
          <span className="text-[10px]">📱</span>
          <span>Product</span>
        </button>
        <button
          onClick={onAppClick}
          className={`flex-1 rounded-[18px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
            selectedTarget === "app"
              ? "bg-[#3a3d45] text-white"
              : "text-white/55 hover:text-white hover:bg-white/5"
          }`}
        >
          <span className="text-[10px]">⌚</span>
          <span>App</span>
        </button>
      </div>

      {/* MAIN COMPOSER BAR - ONE CONNECTED HORIZONTAL UNIT */}
      <div className="relative flex h-[116px] flex-1 items-stretch rounded-[24px] border border-white/10 bg-[#24262b] p-3 shadow-[0_8px_0_rgba(0,0,0,0.25),inset_0_0_0_1px_rgba(255,255,255,0.04)]">
        {/* LEFT: PLUS BUTTON + PROMPT INPUT */}
        <div className="flex min-w-0 flex-1 flex-col justify-between pr-3">
          {/* Top Row: Plus + Textarea */}
          <div className="flex items-start gap-3">
            <button
              onClick={onMediaAttachClick}
              className="flex-shrink-0 size-8 rounded-xl bg-white/8 text-white/80 hover:bg-white/12 flex items-center justify-center transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Describe what happens in the ad..."
              className="min-h-[32px] flex-1 resize-none bg-transparent pt-1 text-sm text-white outline-none placeholder:text-white/55"
            />
          </div>

          {/* Bottom Row: Chips */}
          <div className="flex items-center gap-2">
            <button
              onClick={onUgcClick}
              className={`h-8 rounded-lg px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                selectedMode === "UGC"
                  ? "bg-cyan-400/20 text-cyan-300"
                  : "bg-white/7 text-white hover:bg-white/10"
              }`}
            >
              <span className="text-[9px]">▼</span> UGC
            </button>
            <button
              onClick={onHookClick}
              className="h-8 rounded-lg px-3 bg-white/7 text-white hover:bg-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span className="text-[9px]">🎯</span> Hook {selectedHook ? `: ${selectedHook.title}` : ""}
            </button>
            <button
              onClick={onSettingClick}
              className="h-8 rounded-lg px-3 bg-white/7 text-white hover:bg-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span className="text-[9px]">🌍</span> {selectedSetting ? selectedSetting.title : "Setting"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  activeFloatingPanel === "setting" ? "rotate-180" : ""
                }`}
              />
            </button>
            <button
              ref={optionsButtonRef}
              onClick={onOptionsClick}
              className="h-8 w-8 rounded-lg bg-white/7 text-white hover:bg-white/10 flex items-center justify-center transition-colors hover:scale-[1.03] active:scale-[0.97]"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* RIGHT: PRODUCT TILE + AVATAR TILE + ATTACHED MEDIA + GENERATE */}
        <div className="flex shrink-0 items-center gap-2">
          {/* PRODUCT TILE */}
          <button
            onClick={onProductCardClick}
            className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors cursor-pointer"
          >
            <div className="self-start size-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
              <Plus className="h-3 w-3" />
            </div>
            <span>PRODUCT</span>
          </button>

          {/* AVATAR TILE */}
          <button
            onClick={onAvatarCardClick}
            className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors cursor-pointer"
          >
            <div className="self-start size-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors">
              <Plus className="h-3 w-3" />
            </div>
            <span>AVATAR</span>
          </button>

          {/* ATTACHED MEDIA PREVIEW - Shows first attached image */}
          {attachedProductMedia.length > 0 && (
            <div className="relative h-20 w-[78px] rounded-xl bg-white/7 hover:bg-white/10 flex flex-col justify-between p-2 text-white text-[10px] font-bold transition-colors overflow-hidden group">
              <img
                src={attachedProductMedia[0].previewUrl}
                alt="Attached media"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/60 transition-colors" />
              <span className="relative z-10 text-xs bg-cyan-400/80 text-black px-1 rounded">
                {attachedProductMedia.length}
              </span>
              <span className="relative z-10">MEDIA</span>
            </div>
          )}

          {/* GENERATE BUTTON */}
          <button
            onClick={onGenerate}
            className="h-20 w-[120px] rounded-xl bg-[linear-gradient(135deg,#1fffd0_0%,#00c8ff_100%)] hover:opacity-90 text-black flex flex-col items-center justify-center font-bold text-sm transition-opacity"
          >
            <span>GENERATE</span>
            <div className="text-[10px] mt-1">✦ 156 130</div>
          </button>
        </div>
      </div>
    </div>
  );
}

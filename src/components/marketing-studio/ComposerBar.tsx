"use client";

type ComposerMode = "image" | "video";

import { PROMPT_BAR_SURFACE } from "@/lib/promptBarChassis";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import type { PromptSurfaceResizeController } from "@/hooks/usePromptSurfaceResize";
import { UploadedMedia } from "./MediaAttachPanel";
import MarketingPromptControls from "./MarketingPromptControls";

interface ComposerBarProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  composerMode: ComposerMode;
  onComposerModeChange: (mode: ComposerMode) => void;
  selectedImageModel: string;
  onImageModelChange: (name: string) => void;
  attachedProductMedia: UploadedMedia[];
  onGenerate: () => void;
  resizeWidth: number;
  resizeHeight: number;
  resizeController: PromptSurfaceResizeController;
  isSticky?: boolean;
}

export const MARKETING_COMPOSER_DEFAULT_WIDTH = 980;
export const MARKETING_COMPOSER_DEFAULT_HEIGHT = 116;
export const MARKETING_COMPOSER_MAX_WIDTH = 1180;
export const MARKETING_COMPOSER_MAX_HEIGHT = 420;

function ImageModeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-6 ${className}`} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 4.75C3 3.784 3.784 3 4.75 3h14.5c.966 0 1.75.784 1.75 1.75v14.5A1.75 1.75 0 0 1 19.25 21H4.75A1.75 1.75 0 0 1 3 19.25zm1.75-.25a.25.25 0 0 0-.25.25v9.69l2.263-2.263a1.75 1.75 0 0 1 2.474 0l7.324 7.323h2.689a.25.25 0 0 0 .25-.25V4.75a.25.25 0 0 0-.25-.25zm9.69 15-6.263-6.263a.25.25 0 0 0-.354 0L4.5 16.561v2.689c0 .138.112.25.25.25z"
      />
      <path
        fill="currentColor"
        d="M13.426 8.537a.25.25 0 0 0 .111-.112l.74-1.478a.25.25 0 0 1 .447 0l.739 1.478a.25.25 0 0 0 .112.112l1.478.74a.25.25 0 0 1 0 .447l-1.479.739a.25.25 0 0 0-.111.112l-.74 1.478a.25.25 0 0 1-.447 0l-.739-1.479a.25.25 0 0 0-.112-.111l-1.478-.74a.25.25 0 0 1 0-.447z"
      />
    </svg>
  );
}

function VideoModeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`size-6 ${className}`} aria-hidden>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="m17.25 9 3.094-1.375a1 1 0 0 1 1.406.914v6.922a1 1 0 0 1-1.406.914L17.25 15M2.75 6.25a1 1 0 0 1 1-1h12.5a1 1 0 0 1 1 1v11.5a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1z"
      />
    </svg>
  );
}

function ModeToggleButton({
  active,
  label,
  onClick,
  icon: Icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: (props: { className?: string }) => React.ReactElement;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} mode`}
      aria-pressed={active}
      className={`flex w-full flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] border transition-all duration-200 active:scale-95 ${
        active
          ? "border-[#D97757] bg-[#101112] font-bold text-white"
          : "border-transparent bg-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className={active ? "size-5 text-[#D97757]" : "size-5 text-neutral-400"} />
      <span className="text-[11px] font-extrabold tracking-wide">{label}</span>
    </button>
  );
}

export default function ComposerBar({
  prompt,
  onPromptChange,
  composerMode,
  onComposerModeChange,
  selectedImageModel,
  onImageModelChange,
  attachedProductMedia,
  onGenerate,
  resizeWidth,
  resizeHeight,
  resizeController,
}: ComposerBarProps) {
  return (
    <div
      className={`relative mx-auto h-[116px] flex-none ${
        resizeController.isResizing
          ? ""
          : "transition-[width,transform] duration-150 ease-out"
      }`}
      style={{
        width: resizeWidth,
        transform: `translateX(${Math.max(
          0,
          resizeWidth - MARKETING_COMPOSER_DEFAULT_WIDTH,
        ) / 2}px)`,
      }}
    >
      <div
        className="absolute inset-x-0 bottom-0 flex items-end gap-2"
        style={{ height: resizeHeight }}
      >
      {/* LEFT IMAGE/VIDEO SELECTOR - MATCHES /GENERATE MODE TOGGLE SHAPE */}
      <div
        className="relative z-50 flex h-[116px] min-h-[116px] w-[68px] min-w-[68px] shrink-0 rounded-[20px] border-2 p-1 animate-pulse-orange-white"
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
        <div className="flex h-full w-full flex-col gap-1" role="tablist" aria-orientation="vertical">
          <ModeToggleButton
            active={composerMode === "image"}
            label="Image"
            icon={ImageModeIcon}
            onClick={() => onComposerModeChange("image")}
          />
          <ModeToggleButton
            active={composerMode === "video"}
            label="Video"
            icon={VideoModeIcon}
            onClick={() => onComposerModeChange("video")}
          />
        </div>
      </div>

      {/* MAIN COMPOSER BAR - WITH EXACT /GENERATE PROMPT BAR LIGHTING GLOW & SYNCED PULSE */}
      <div
        className={`relative flex min-w-0 flex-1 items-stretch rounded-[24px] p-3 animate-pulse-orange-white ${
          resizeController.isResizing
            ? ""
            : "transition-[height] duration-150 ease-out"
        }`}
        style={{
          background:
            "linear-gradient(180deg, rgba(217,119,87,0.28) 0%, rgba(217,119,87,0.16) 55%, rgba(217,119,87,0.10) 100%), #141414",
          border: "1px solid rgba(217, 119, 87, 0.45)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 25px rgba(217,119,87,0.18), 0 10px 30px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          height: resizeHeight,
        }}
      >
        <PromptResizeHandles
          verticalHandleProps={resizeController.verticalHandleProps}
          cornerHandleProps={resizeController.cornerHandleProps}
          isResizing={resizeController.isResizing}
          verticalLabel="Resize marketing prompt height"
          cornerLabel="Resize marketing prompt width and height"
        />

        {/* LEFT: PROMPT INPUT + IMAGE CONTROLS */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 pr-3">
          <div className="flex items-start gap-3">
            <input
              type="text"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Describe what happens in the ad..."
              className="min-h-[32px] flex-1 resize-none bg-transparent pt-1 text-sm text-white outline-none placeholder:text-white/55"
            />
          </div>
          {composerMode === "image" && (
            <MarketingPromptControls
              selectedImageModel={selectedImageModel}
              onImageModelChange={onImageModelChange}
            />
          )}
        </div>

        {/* RIGHT: ATTACHED MEDIA + GENERATE */}
        <div className="flex shrink-0 items-end gap-2">
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
            className="h-20 w-[120px] rounded-xl bg-[linear-gradient(135deg,#D97757_0%,#B85A3E_100%)] hover:opacity-90 text-black flex flex-col items-center justify-center font-bold text-sm transition-opacity"
          >
            <span>GENERATE</span>
            <div className="text-[10px] mt-1">✦ 156 130</div>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

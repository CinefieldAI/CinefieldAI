"use client";

import { Plus, ChevronDown, Settings } from "lucide-react";
import { PROMPT_BAR_SURFACE } from "@/lib/promptBarChassis";
import PromptResizeHandles from "@/components/shared/PromptResizeHandles";
import type { PromptSurfaceResizeController } from "@/hooks/usePromptSurfaceResize";
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
  resizeWidth: number;
  resizeHeight: number;
  resizeController: PromptSurfaceResizeController;
  isSticky?: boolean;
}

export const MARKETING_COMPOSER_DEFAULT_WIDTH = 980;
export const MARKETING_COMPOSER_DEFAULT_HEIGHT = 116;
export const MARKETING_COMPOSER_MAX_WIDTH = 1180;
export const MARKETING_COMPOSER_MAX_HEIGHT = 420;

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
      {/* LEFT PRODUCT/APP SELECTOR WITH MATCHING SYNCED LIGHTING */}
      <div
        className="gap-2 p-1 rounded-[20px] backdrop-blur-[12px] h-[116px] min-h-[116px] w-[70px] overflow-hidden border animate-pulse-orange-white"
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
        <div
          className="relative flex h-full min-h-0 flex-col justify-center gap-1 overflow-hidden rounded-[16px] p-0"
          role="tablist"
          aria-orientation="horizontal"
          tabIndex={0}
        >
          {/* SLIDING HIGHLIGHT BACKDROP */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-0 rounded-[16px] bg-white/15 backdrop-blur-[12px]"
            style={{
              height: "calc(50% - 2px)",
              transform: `translateY(${selectedTarget === "app" ? "100%" : "0px"})`,
              transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
          />

          {/* PRODUCT BUTTON */}
          <button
            type="button"
            role="tab"
            aria-selected={selectedTarget === "product"}
            onClick={onProductClick}
            className={`relative z-1 flex h-auto min-h-0 w-full min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-[16px] border-none px-3 py-1.5 cursor-pointer text-[10px] leading-[14px] font-semibold tracking-[0] transition-colors duration-200 ${
              selectedTarget === "product"
                ? "text-white"
                : "text-white/50 hover:text-white/65"
            }`}
          >
            <span className="flex flex-col items-center gap-1">
              <svg
                className="size-4 shrink-0 [&_path]:stroke-2"
                aria-hidden="true"
                width="24px"
                height="24px"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.0002 12V20.5M12.0002 12L4.5 7.78123M12.0002 12L19.2627 7.91473M20.25 7.94421V16.0558C20.25 16.417 20.0551 16.7502 19.7403 16.9273L12.4903 21.0055C12.1858 21.1767 11.8142 21.1767 11.5097 21.0055L4.25974 16.9273C3.94486 16.7502 3.75 16.417 3.75 16.0558V7.94421C3.75 7.58294 3.94486 7.24976 4.25974 7.07264L11.5097 2.99451C11.8142 2.82328 12.1858 2.82328 12.4903 2.99451L19.7403 7.07264C20.0551 7.24976 20.25 7.58294 20.25 7.94421Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Product</span>
            </span>
          </button>

          {/* APP BUTTON */}
          <button
            type="button"
            role="tab"
            aria-selected={selectedTarget === "app"}
            onClick={onAppClick}
            className={`relative z-1 flex h-auto min-h-0 w-full min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-[16px] border-none px-3 py-1.5 cursor-pointer text-[10px] leading-[14px] font-semibold tracking-[0] transition-colors duration-200 ${
              selectedTarget === "app"
                ? "text-white"
                : "text-white/50 hover:text-white/65"
            }`}
          >
            <span className="flex flex-col items-center gap-1">
              <svg
                className="size-4 shrink-0 [&_path]:stroke-2"
                aria-hidden="true"
                width="24px"
                height="24px"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M4.59772 7.8189C3.8989 9.05344 3.5 10.4801 3.5 12C3.5 14.0772 4.24511 15.9804 5.48263 17.4569L8.77446 14.165C7.18407 12.4893 5.93655 10.7647 5.18607 9.26371C4.93786 8.76728 4.7369 8.28128 4.59772 7.8189ZM7.81933 4.59748C8.28167 4.73666 8.76762 4.9376 9.264 5.18579C10.765 5.93627 12.4895 7.18378 14.1653 8.77417L17.4569 5.48263C15.9804 4.24511 14.0772 3.5 12 3.5C10.4803 3.5 9.05377 3.89881 7.81933 4.59748ZM18.521 4.41847C16.7702 2.91117 14.4915 2 12 2C6.47715 2 2 6.47715 2 12C2 14.4915 2.91117 16.7702 4.41847 18.521L3.69164 19.2479C3.39875 19.5408 3.39875 20.0156 3.69164 20.3085C3.98453 20.6014 4.45941 20.6014 4.7523 20.3085L5.47914 19.5817C7.22995 21.0889 9.50857 22 12 22C17.5228 22 22 17.5228 22 12C22 9.50857 21.0889 7.22995 19.5817 5.47914L20.3087 4.75217C20.6015 4.45928 20.6015 3.9844 20.3087 3.69151C20.0158 3.39862 19.5409 3.39862 19.248 3.69151L18.521 4.41847ZM18.5175 6.54331L15.226 9.83483C16.8164 11.5106 18.064 13.2353 18.8145 14.7363C19.0626 15.2325 19.2635 15.7183 19.4026 16.1805C20.1012 14.9461 20.5 13.5196 20.5 12C20.5 9.92287 19.7549 8.01975 18.5175 6.54331ZM16.1809 19.4024C15.7186 19.2632 15.2328 19.0623 14.7366 18.8142C13.2356 18.0637 11.5109 16.8161 9.83511 15.2257L6.54331 18.5175C8.01975 19.7549 9.92287 20.5 12 20.5C13.5198 20.5 14.9464 20.1011 16.1809 19.4024ZM10.8962 14.1647C12.4812 15.6646 14.0757 16.8067 15.4074 17.4726C16.1523 17.845 16.7763 18.0488 17.2471 18.1046C17.7286 18.1617 17.9182 18.0535 17.986 17.9857C18.0537 17.918 18.162 17.7283 18.1049 17.2468C18.0491 16.776 17.8453 16.152 17.4728 15.4071C16.807 14.0754 15.6649 12.4809 14.165 10.8959L10.8962 14.1647ZM13.1043 9.83521C11.5193 8.33534 9.92486 7.19327 8.59318 6.52743C7.84824 6.15496 7.2243 5.95115 6.75348 5.89535C6.27197 5.83829 6.08232 5.94653 6.01457 6.01428C5.94682 6.08203 5.83858 6.27168 5.89564 6.75319C5.95144 7.22401 6.15525 7.84795 6.52772 8.59289C7.19356 9.92458 8.33563 11.519 9.83549 13.104L13.1043 9.83521Z"
                  fill="currentColor"
                />
              </svg>
              <span>App</span>
            </span>
          </button>
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
        <div className="flex shrink-0 items-end gap-2">
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

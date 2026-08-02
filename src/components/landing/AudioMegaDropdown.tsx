"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  AUDIO_FEATURES,
  AUDIO_MODELS,
  type AudioFeature,
  type AudioModel,
} from "./audioMenuData";

interface AudioMegaDropdownProps {
  onFeatureSelect?: (title: string) => void;
  onModelSelect?: (title: string) => void;
  /** Title of the currently active feature (drives the bottom rotary selector). */
  activeFeatureTitle?: string;
  /** Title of the currently active model (drives the prompt-bar model pill). */
  activeModelTitle?: string;
}

function AudioColumn({
  title,
  items,
  activeTitle,
  onSelect,
}: {
  title: string;
  items: (AudioFeature | AudioModel)[];
  activeTitle?: string;
  onSelect?: (title: string) => void;
}) {
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(activeTitle);

  const handleSelect = (t: string) => {
    setSelectedTitle(t);
    onSelect?.(t);
  };

  const currentActive = selectedTitle ?? activeTitle;

  return (
    <section className="min-w-0 p-1">
      <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
        {title.toUpperCase()}
      </p>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const iconSrc = "iconSrc" in item ? item.iconSrc : undefined;
          const active = item.title === currentActive;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => handleSelect(item.title)}
              aria-pressed={active}
              className={`group relative flex min-h-[72px] items-center gap-3 rounded-xl px-3 py-2.5 text-left no-underline transition-all duration-160 ease-out border ${
                active
                  ? "bg-[rgba(217,119,87,0.075)] border-[rgba(217,119,87,0.36)]"
                  : "bg-white/[0.022] border-white/[0.055] hover:bg-white/[0.04] hover:border-[rgba(217,119,87,0.18)]"
              } active:brightness-[.8]`}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-[#D97757]" />
              )}
              <div
                className={`relative size-12 min-w-[48px] min-h-[48px] rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
                  active
                    ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)]"
                    : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)]"
                }`}
                style={{
                  background:
                    "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
                }}
              >
                <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center overflow-hidden">
                  {iconSrc ? (
                    <img
                      src={iconSrc}
                      alt=""
                      className="size-6 object-contain"
                      aria-hidden="true"
                    />
                  ) : (
                    <Icon className="size-6 text-white" />
                  )}
                </div>
              </div>
              <div className="flex flex-1 flex-col min-w-0 justify-center gap-0.5">
                <span className="truncate text-[16px] font-semibold leading-5 text-white">
                  {item.title}
                </span>
                <span className="truncate text-[13px] font-normal leading-[18px] text-white/60">
                  {item.description}
                </span>
              </div>
              {active && <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function AudioMegaDropdown({
  onFeatureSelect,
  onModelSelect,
  activeFeatureTitle,
  activeModelTitle,
}: AudioMegaDropdownProps) {
  return (
    <div
      className="w-[740px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] h-auto overflow-y-auto rounded-[16px] border border-white/[0.08] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px]"
      style={{
        background: "rgba(28, 30, 32, 0.98)",
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <AudioColumn
          title="Features"
          items={AUDIO_FEATURES}
          activeTitle={activeFeatureTitle}
          onSelect={onFeatureSelect}
        />
        <AudioColumn
          title="Models"
          items={AUDIO_MODELS}
          activeTitle={activeModelTitle}
          onSelect={onModelSelect}
        />
      </div>
    </div>
  );
}

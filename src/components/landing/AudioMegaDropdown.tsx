"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  AUDIO_FEATURES,
  AUDIO_MODELS,
  type AudioFeature,
  type AudioModel,
} from "./audioMenuData";
import AudioModelCardVisual from "./AudioModelCardVisual";

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
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(
    activeTitle,
  );

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
          const isModel = "iconSrc" in item;
          const active = item.title === currentActive;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => handleSelect(item.title)}
              aria-pressed={active}
              className="group relative flex min-h-[72px] items-center gap-3 rounded-xl px-3 py-2.5 text-left no-underline transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[2px] hover:scale-[1.008] active:translate-y-0 active:scale-[0.995] active:brightness-[.85]"
              style={{
                background:
                  "linear-gradient(160deg, rgba(46,48,51,0.95) 0%, rgba(38,40,43,0.95) 50%, rgba(30,32,35,0.95) 100%)",
              }}
            >
              {isModel ? (
                <AudioModelCardVisual
                  item={item as AudioModel}
                  variant="navbar"
                  active={active}
                />
              ) : (
                <>
                  <div
                    className={`relative size-12 min-h-[48px] min-w-[48px] shrink-0 origin-center rounded-[13px] p-[1.5px] transition-all duration-300 ease-out group-hover:scale-[1.1] ${
                      active
                        ? "shadow-[0_-4px_16px_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,87,0.95)]"
                        : "shadow-[0_-2px_8px_rgba(255,255,255,0.40),0_4px_14px_rgba(217,119,87,0.60)] group-hover:shadow-[0_-4px_18px_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,87,0.90)]"
                    }`}
                    style={{
                      background:
                        "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
                    }}
                  >
                    <div
                      className="relative flex size-full items-center justify-center overflow-hidden rounded-[11px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.45)]"
                      style={{
                        background:
                          "linear-gradient(180deg, #E6E6E6 0%, #A0A0A0 42%, #D97757 72%, #A8482A 100%)",
                      }}
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-[48%] rounded-t-[11px] bg-gradient-to-b from-white/70 to-transparent" />
                      <Icon className="relative z-10 size-6 text-white drop-shadow-[0_1px_2px_rgba(255,255,255,0.28)]" />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <span className="truncate text-[16px] font-semibold leading-5 text-white">
                      {item.title}
                    </span>
                    <span className="truncate text-[13px] font-normal leading-[18px] text-white/65">
                      {item.description}
                    </span>
                  </div>
                </>
              )}
              {active && (
                <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />
              )}
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
      className="h-auto w-[800px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-70px)] overflow-x-hidden overflow-y-auto rounded-[16px] border border-white/[0.08] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px]"
      style={{
        background: "rgba(28, 30, 32, 0.98)",
      }}
    >
      <div className="grid w-full grid-cols-2 gap-3 [zoom:0.8]">
        <AudioColumn
          title="Features"
          items={AUDIO_FEATURES}
          activeTitle={activeFeatureTitle}
          onSelect={onFeatureSelect}
        />
        <AudioColumn
          title="Models"
          items={AUDIO_MODELS.filter((item) => item.title !== "VibeVoice")}
          activeTitle={activeModelTitle}
          onSelect={onModelSelect}
        />
      </div>
    </div>
  );
}

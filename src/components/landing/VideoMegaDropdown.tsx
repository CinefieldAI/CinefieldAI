"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { VIDEO_DROPDOWN_MODELS, VIDEO_FEATURES } from "./videoMenuData";

interface VideoMegaDropdownProps {
  onFeatureSelect?: (title: string) => void;
  onModelSelect?: (name: string) => void;
  activeFeatureTitle?: string;
  activeModelName?: string;
}

export default function VideoMegaDropdown({
  onFeatureSelect,
  onModelSelect,
  activeFeatureTitle,
  activeModelName,
}: VideoMegaDropdownProps) {
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>(
    activeModelName ?? activeFeatureTitle ?? "Seedance 2.0 4K",
  );

  const handleFeatureClick = (title: string) => {
    setSelectedTitle(title);
    onFeatureSelect?.(title);
  };

  const handleModelClick = (name: string) => {
    setSelectedTitle(name);
    onModelSelect?.(name);
  };

  return (
    <div
      className="w-[740px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] overflow-y-auto rounded-[16px] border border-white/[0.08] p-3 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px]"
      style={{
        background: "rgba(28, 30, 32, 0.98)",
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {/* LEFT: Features */}
        <section className="min-w-0 p-1">
          <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
            FEATURES
          </p>
          <div className="flex flex-col gap-1.5">
            {VIDEO_FEATURES.map((feature) => {
              const Icon = feature.icon;
              const active = selectedTitle === feature.title;
              return (
                <button
                  key={feature.title}
                  type="button"
                  onClick={() => handleFeatureClick(feature.title)}
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
                      <Icon className="size-6 text-white" />
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col min-w-0 justify-center gap-0.5">
                    <span className="truncate text-[16px] font-semibold leading-5 text-white">
                      {feature.title}
                    </span>
                    <span className="truncate text-[13px] font-normal leading-[18px] text-white/60">
                      {feature.description}
                    </span>
                  </div>
                  {active && <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* RIGHT: Models */}
        <section className="min-w-0 p-1">
          <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
            MODELS
          </p>
          <div className="flex flex-col gap-1.5">
            {VIDEO_DROPDOWN_MODELS.map((model) => {
              const Icon = model.icon;
              const active = selectedTitle === model.name;
              return (
                <button
                  key={model.name}
                  type="button"
                  onClick={() => handleModelClick(model.name)}
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
                      <Icon className="size-6 text-white" aria-hidden="true" />
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col min-w-0 justify-center gap-0.5">
                    <span className="truncate text-[16px] font-semibold leading-5 text-white">
                      {model.name}
                    </span>
                    <span className="truncate text-[13px] font-normal leading-[18px] text-white/60">
                      {model.meta}
                    </span>
                  </div>
                  {active && <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

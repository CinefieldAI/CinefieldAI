"use client";

import { useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import {
  ALL_DROPDOWN_MODELS,
  FEATURED_DROPDOWN_MODELS,
  IMAGE_FEATURES,
  type ImageFeatureKey,
  type ImageModel,
} from "./imageDropdownData";

interface ImageMegaDropdownProps {
  onFeatureSelect: (key: ImageFeatureKey) => void;
  onModelSelect: (name: string) => void;
}

// Test pilot (2026-08-01): these 5 rows use a warmer "card" treatment
// (solid orange gradient background/border, solid-orange icon tile) instead
// of the standard subtle row style. Explicit revert path if it doesn't work
// out: drop this set and PILOT_CARD_* below, no other changes needed.
const PILOT_CARD_MODEL_NAMES = new Set([
  "Seedream 5.0 Pro",
  "Seedream 5.0 lite",
  "Seedream 4.5",
  "Nano Banana Pro",
  "Nano Banana 2",
]);

export default function ImageMegaDropdown({
  onFeatureSelect,
  onModelSelect,
}: ImageMegaDropdownProps) {
  const [selectedTitle, setSelectedTitle] = useState<string>("Nano Banana Pro");

  const handleFeatureClick = (key: ImageFeatureKey, title: string) => {
    setSelectedTitle(title);
    onFeatureSelect(key);
  };

  const handleModelClick = (name: string) => {
    setSelectedTitle(name);
    onModelSelect(name);
  };

  const renderModelButton = (model: ImageModel) => {
    const Icon = typeof model.icon === "string" ? null : model.icon;
    const active = selectedTitle === model.name;
    const isPilotCard = PILOT_CARD_MODEL_NAMES.has(model.name);

    if (isPilotCard) {
      return (
        <button
          key={model.name}
          type="button"
          onClick={() => handleModelClick(model.name)}
          className={`group relative flex min-h-[72px] items-center gap-3 rounded-xl px-3 py-2.5 text-left no-underline transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] border hover:-translate-y-[2px] hover:scale-[1.008] active:translate-y-0 active:scale-[0.995] ${
            active
              ? "border-[rgba(217,119,87,0.65)]"
              : "border-[rgba(217,119,87,0.30)] hover:border-[rgba(217,119,87,0.55)]"
          } active:brightness-[.85]`}
          style={{
            background:
              "linear-gradient(160deg, rgba(20,17,16,0.98) 0%, rgba(14,12,11,0.98) 50%, rgba(10,9,8,1) 100%)",
          }}
        >
          <div
            className={`relative size-12 min-w-[48px] min-h-[48px] rounded-[13px] p-[1.5px] shrink-0 origin-center transition-all duration-300 ease-out group-hover:scale-[1.1] ${
              active
                ? "shadow-[0_-4px_16px_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,87,0.95)]"
                : "shadow-[0_-2px_8px_rgba(255,255,255,0.40),0_4px_14px_rgba(217,119,87,0.60)] group-hover:shadow-[0_-4px_18px_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,87,0.90)]"
            }`}
            style={{
              background:
                "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
            }}
          >
            {/* 3D Metallic Glossy Glass Inner Badge */}
            <div
              className="w-full h-full rounded-[11px] flex items-center justify-center overflow-hidden relative shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.45)]"
              style={{
                background:
                  "linear-gradient(180deg, #E6E6E6 0%, #A0A0A0 42%, #D97757 72%, #A8482A 100%)",
              }}
            >
              {/* Upper Glass Specular Curve */}
              <div className="absolute top-0 inset-x-0 h-[48%] bg-gradient-to-b from-white/70 to-transparent pointer-events-none rounded-t-[11px]" />

              {typeof model.icon === "string" ? (
                <Image
                  src={model.icon}
                  alt=""
                  width={22}
                  height={22}
                  className="size-6 object-contain relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                />
              ) : (
                Icon && (
                  <Icon
                    className="size-6 text-[#D97757] relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                    aria-hidden="true"
                  />
                )
              )}
            </div>
          </div>
          <div className="flex flex-1 flex-col min-w-0 justify-center gap-0.5">
            <span
              className={`truncate text-[16px] font-semibold leading-5 ${
                model.isAdded ? "text-[#00e5ff]" : "text-white"
              }`}
            >
              {model.name}
            </span>
            <span className="truncate text-[13px] font-normal leading-[18px] text-white/65">
              {model.meta}
            </span>
          </div>
          {active && <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />}
        </button>
      );
    }

    return (
      <button
        key={model.name}
        type="button"
        onClick={() => handleModelClick(model.name)}
        className={`group relative flex min-h-[72px] items-center gap-3 rounded-xl px-3 py-2.5 text-left no-underline transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] border hover:-translate-y-[2px] hover:scale-[1.008] active:translate-y-0 active:scale-[0.995] ${
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
            {typeof model.icon === "string" ? (
              <Image
                src={model.icon}
                alt=""
                width={20}
                height={20}
                className="size-6 object-contain"
              />
            ) : (
              Icon && <Icon className="size-6 text-white" aria-hidden="true" />
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col min-w-0 justify-center gap-0.5">
          <span
            className={`truncate text-[16px] font-semibold leading-5 ${
              model.isAdded ? "text-[#00e5ff]" : "text-white"
            }`}
          >
            {model.name}
          </span>
          <span className="truncate text-[13px] font-normal leading-[18px] text-white/60">
            {model.meta}
          </span>
        </div>
        {active && <Check className="size-4 shrink-0 text-[#D97757] ml-auto" />}
      </button>
    );
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
            {IMAGE_FEATURES.map((feature) => {
              const Icon = feature.icon;
              const active = selectedTitle === feature.title;
              return (
                <button
                  key={feature.key}
                  type="button"
                  onClick={() => handleFeatureClick(feature.key, feature.title)}
                  className={`group relative flex min-h-[72px] items-center gap-3 rounded-xl px-3 py-2.5 text-left no-underline transition-all duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] border hover:-translate-y-[2px] hover:scale-[1.008] active:translate-y-0 active:scale-[0.995] ${
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

        {/* RIGHT: Featured Models + All Models */}
        <section className="min-w-0 p-1 flex flex-col gap-3">
          {/* Featured Models Section */}
          <div>
            <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
              FEATURED MODELS
            </p>
            <div className="flex flex-col gap-1.5">
              {FEATURED_DROPDOWN_MODELS.map(renderModelButton)}
            </div>
          </div>

          {/* All Models Section */}
          <div>
            <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/40">
              ALL MODELS
            </p>
            <div className="flex flex-col gap-1.5">
              {ALL_DROPDOWN_MODELS.map(renderModelButton)}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

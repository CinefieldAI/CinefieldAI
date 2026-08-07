"use client";

import React from "react";
import { Check } from "lucide-react";
import type { CreateImageModel } from "./createImageData";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";
import { BLOCKED_MODEL_LABEL_CLASS, isBlockedModelLabel } from "@/lib/blockedModels";

interface ModelItemProps {
  model: CreateImageModel;
  isSelected: boolean;
  onSelect: (name: string) => void;
  isContinuation?: boolean;
}

export default function ModelItem({ model, isSelected, onSelect, isContinuation }: ModelItemProps) {
  const sharedIcon = getSharedModelIcon(model.name);
  const IconComp = (sharedIcon ?? (typeof model.icon === "function" ? model.icon : null)) as React.ComponentType<{ className?: string; style?: React.CSSProperties }> | null;
  const iconSrc = typeof model.icon === "string" ? model.icon : null;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(model.name)}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-180 ease-out cursor-pointer hover:translate-x-[2px] focus-visible:outline-none ${
        isSelected
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08]"
      }`}
    >
      {/* Selected Indicator: 3px Rounded Accent Line (#D97757) */}
      {isSelected ? (
        <span
          aria-hidden
          className="w-[3px] h-7 rounded-full bg-[#D97757] shrink-0 mr-2 shadow-[0_0_8px_rgba(217,119,87,0.8)]"
        />
      ) : isContinuation ? (
        <span
          aria-hidden
          className="w-[2px] h-7 rounded-full shrink-0 mr-2"
          style={{
            background: "rgba(255, 255, 255, 0.95)",
            boxShadow:
              "0 0 6px rgba(255, 255, 255, 0.85), 0 0 12px rgba(255, 255, 255, 0.42)",
          }}
        />
      ) : null}

      {/* 40x40 Icon Container with Hard Horizontal Split Two-Tone Neon Border (Top White / Bottom Orange) */}
      <div
        className={`relative size-10 rounded-[12px] p-[1.5px] shrink-0 transition-all duration-180 ease-out ${
          isSelected || isContinuation
            ? "shadow-[0_-4px_14px_rgba(255,255,255,0.70),0_5px_18px_rgba(217,119,87,0.90)] mr-2.5"
            : "shadow-[0_-2px_6px_rgba(255,255,255,0.30),0_3px_8px_rgba(217,119,87,0.40)] group-hover/model-row:shadow-[0_-3px_10px_rgba(255,255,255,0.50),0_4px_14px_rgba(217,119,87,0.65)] group-hover/model-row:scale-[1.02] mr-3"
        }`}
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 50%, #D97757 50%, #D97757 100%)",
        }}
      >
        {/* Dark Center (Center: rgba(18,18,18,.95), edges: rgba(28,28,28,.90), zero orange fill) */}
        <div className="w-full h-full rounded-[10.5px] bg-[radial-gradient(ellipse_at_center,rgba(18,18,18,0.95)_0%,rgba(28,28,28,0.90)_100%)] flex items-center justify-center">
          {IconComp ? (
            <IconComp
              className={`size-4.5 text-white transition-all duration-180 ${
                isSelected
                  ? "text-white [filter:drop-shadow(0_0_6px_rgba(255,255,255,0.85))]"
                  : "text-white/90 group-hover/model-row:text-white group-hover/model-row:[filter:drop-shadow(0_0_5px_rgba(217,119,87,0.35))]"
              }`}
            />
          ) : iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className={`size-4.5 object-contain transition-all duration-180 ${
                isSelected
                  ? "[filter:drop-shadow(0_0_6px_rgba(255,255,255,0.85))]"
                  : "group-hover/model-row:[filter:drop-shadow(0_0_5px_rgba(217,119,87,0.35))]"
              }`}
            />
          ) : (
            <span className="text-xs font-bold text-white">{model.name.charAt(0)}</span>
          )}
        </div>
      </div>

      {/* Model Title & Description */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
        <span
          className={`truncate text-xs font-semibold transition-colors duration-180 ${
            isBlockedModelLabel(model.name)
              ? BLOCKED_MODEL_LABEL_CLASS
              : isSelected
                ? "text-white font-bold"
                : "text-white/90 group-hover/model-row:text-white"
          }`}
        >
          {model.name}
        </span>
        <p className="text-[10px] text-white/45 group-hover/model-row:text-white/60 truncate font-normal">
          {model.description}
        </p>
      </div>

      {/* Selection Checkmark */}
      <div className="size-5 shrink-0 flex items-center justify-center ml-1">
        {isSelected && (
          <Check className="size-4 text-[#D97757] drop-shadow-[0_0_6px_rgba(217,119,87,0.6)]" />
        )}
      </div>
    </button>
  );
}

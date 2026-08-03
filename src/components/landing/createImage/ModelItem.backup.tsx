"use client";

import React from "react";
import { Check } from "lucide-react";
import type { CreateImageModel } from "./createImageData";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";

interface ModelItemProps {
  model: CreateImageModel;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

export default function ModelItem({ model, isSelected, onSelect }: ModelItemProps) {
  const sharedIcon = getSharedModelIcon(model.name);
  const IconComp = sharedIcon ?? (typeof model.icon === "function" ? model.icon : null);
  const iconSrc = typeof model.icon === "string" ? model.icon : null;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(model.name)}
      className="group/model-row w-full flex items-center pl-2 py-2 pr-3 rounded-xl text-start transition-colors duration-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none cursor-pointer"
    >
      {/* 40x40 Icon Tile with Orange Hover Light Glow */}
      <div
        className={`size-10 rounded-xl flex items-center justify-center shrink-0 mr-3 transition-all duration-200 ${
          isSelected
            ? "bg-[rgba(217,119,87,0.20)] text-[#D97757] border border-[rgba(217,119,87,0.50)] shadow-[0_0_14px_rgba(217,119,87,0.40)]"
            : "bg-white/5 text-gray-400 border border-white/5 shadow-[inset_0px_2px_3px_0px_rgba(255,255,255,0.03)] group-hover/model-row:bg-[rgba(217,119,87,0.22)] group-hover/model-row:text-[#D97757] group-hover/model-row:border-[#D97757]/40 group-hover/model-row:shadow-[0_0_16px_rgba(217,119,87,0.45)]"
        }`}
      >
        {IconComp ? (
          <IconComp className="size-4" />
        ) : iconSrc ? (
          <img src={iconSrc} alt="" className="size-4 object-contain" />
        ) : (
          <span className="text-xs font-semibold">{model.name.charAt(0)}</span>
        )}
      </div>

      {/* Model Title & Description (Uniform for all models, badges removed) */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 items-start">
        <span className="truncate text-xs font-medium text-white group-hover/model-row:text-white">
          {model.name}
        </span>
        <p className="text-[10px] text-gray-400 truncate">
          {model.description}
        </p>
      </div>

      {/* Selection Checkmark */}
      <div className="size-5 shrink-0 flex items-center justify-center">
        {isSelected && (
          <Check className="size-4 text-[#D97757]" />
        )}
      </div>
    </button>
  );
}

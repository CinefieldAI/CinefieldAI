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
  /** Roving-tabindex wiring from useListboxNav — the active row is the only
   *  tabbable one and holds real focus while arrow keys move through the list. */
  optionRef?: (el: HTMLElement | null) => void;
  tabIndex?: number;
  /**
   * The row the arrow keys are sitting on. It wears the orange bar, the orange
   * card and the checkmark so the marker travels with the keyboard — but the
   * model itself only changes on Enter/click, because switching model resets
   * every other control in the row.
   */
  isMarked?: boolean;
  onHover?: () => void;
}

export default function ModelItem({
  model,
  isSelected,
  onSelect,
  optionRef,
  tabIndex,
  isMarked,
  onHover,
}: ModelItemProps) {
  // Falls back to the committed selection when nothing is being navigated.
  const marked = isMarked ?? isSelected;
  const sharedIcon = getSharedModelIcon(model.name);
  const IconComp = (sharedIcon ?? (typeof model.icon === "function" ? model.icon : null)) as React.ComponentType<{ className?: string; style?: React.CSSProperties }> | null;
  const iconSrc = typeof model.icon === "string" ? model.icon : null;

  return (
    <button
      ref={optionRef}
      tabIndex={tabIndex}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(model.name)}
      onMouseEnter={onHover}
      className={`group/model-row relative w-full h-[56px] min-h-[56px] flex items-center px-2.5 py-2 rounded-[12px] text-start transition-all duration-200 ease-out cursor-pointer hover:translate-x-[2px] outline-none focus-visible:outline-none ${
        marked
          ? "bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.25)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
          : // Keyboard focus gets the same grey card the mouse hover uses, so
            // arrowing through the list visibly shows where you are.
            "bg-[rgba(255,255,255,0.025)] hover:bg-[rgba(255,255,255,0.055)] focus:bg-[rgba(255,255,255,0.055)] border border-white/[0.03] hover:border-white/[0.08] focus:border-white/[0.08]"
      }`}
    >
      {/* Selected indicator: flat 3px accent line, no glow. The white
          continuation bar that used to sit here was pure light emission and
          has been dropped — selection reads from the fill and the checkmark. */}
      {marked && (
        <span aria-hidden className="mr-2 h-7 w-[3px] shrink-0 rounded-full bg-[#D97757]" />
      )}

      {/* 40x40 Icon Container with Hard Horizontal Split Two-Tone Neon Border (Top White / Bottom Orange) */}
      <div
        className={`relative mr-3 size-10 shrink-0 rounded-[12px] p-[1.5px] transition-all duration-180 ease-out ${
          marked ? "" : "group-hover/model-row:scale-[1.02]"
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
                isSelected ? "text-white" : "text-white/90 group-hover/model-row:text-white"
              }`}
            />
          ) : iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="size-4.5 object-contain transition-all duration-180"
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
              : marked
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
        {marked && (
          <Check className="size-4 text-[#D97757]" />
        )}
      </div>
    </button>
  );
}

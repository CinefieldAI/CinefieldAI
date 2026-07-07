"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Diamond } from "lucide-react";

interface QualityPanelProps {
  anchor: HTMLElement | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (quality: string) => void;
  selectedQuality: string;
  availableQualities: string[];
}

export default function QualityPanel({
  anchor,
  isOpen,
  onClose,
  onSelect,
  selectedQuality,
  availableQualities,
}: QualityPanelProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Calculate position relative to anchor
  useEffect(() => {
    if (!isOpen || !anchor) {
      setPos(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 180;
    const itemHeight = 40;
    const panelHeight = availableQualities.length * itemHeight + 16;

    // Position below the anchor, aligned to the left
    let left = rect.left;
    let top = rect.bottom + 8;

    // Adjust if panel goes off-screen
    if (left + panelWidth > window.innerWidth) {
      left = window.innerWidth - panelWidth - 8;
    }
    if (top + panelHeight > window.innerHeight) {
      top = rect.top - panelHeight - 8;
    }

    setPos({ top, left });
  }, [isOpen, anchor, availableQualities.length]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) && anchor && !anchor.contains(target)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, anchor]);

  if (!isOpen || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[110] w-[180px] rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-2"
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Quality Options */}
      <div className="space-y-1">
        {availableQualities.map((quality) => {
          const isSelected = quality === selectedQuality;
          return (
            <button
              key={quality}
              type="button"
              onClick={() => {
                onSelect(quality);
                onClose();
              }}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all duration-200 ${
                isSelected
                  ? "border-white/20 bg-white/10"
                  : "border-transparent hover:bg-white/5"
              }`}
            >
              <Diamond className="size-3 flex-shrink-0" />
              <span className="flex-1">{quality}</span>
              {isSelected && <Check className="size-3 flex-shrink-0" style={{ color: "#00e5ff" }} />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

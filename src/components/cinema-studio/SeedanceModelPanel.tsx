"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Diamond, Clock } from "lucide-react";

interface SeedanceModelPanelProps {
  anchor: HTMLElement | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  selectedModelId: string;
}

const SEEDANCE_VARIANTS = [
  { id: "seedance-2.0", name: "Seedance 2.0", resolution: "4K", duration: "4s-15s" },
  { id: "seedance-2.0-fast", name: "Seedance 2.0 Fast", resolution: "720p", duration: "4s-15s" },
  { id: "seedance-2.0-mini", name: "Seedance 2.0 Mini", resolution: "720p", duration: "4s-15s" },
];

export default function SeedanceModelPanel({
  anchor,
  isOpen,
  onClose,
  onSelect,
  selectedModelId,
}: SeedanceModelPanelProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !anchor) {
      setPos(null);
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const panelWidth = 340;
    const itemHeight = 56;
    const panelHeight = SEEDANCE_VARIANTS.length * itemHeight + 16;

    let left = rect.left;
    let top = rect.top - panelHeight - 8;

    if (left + panelWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - panelWidth - 8);
    }

    if (top < 8) {
      top = rect.bottom + 8;
    }

    setPos({ top, left });
  }, [isOpen, anchor]);

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
      className="fixed z-[110] w-[340px] rounded-2xl border border-[rgba(217,217,217,0.08)] bg-[rgba(24,26,30,0.92)] shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-[24px] p-2"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="space-y-1">
        {SEEDANCE_VARIANTS.map((model) => {
          const isSelected = model.id === selectedModelId;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onSelect(model.id);
                onClose();
              }}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
                isSelected
                  ? "border-white/20 bg-white/10"
                  : "border-transparent hover:bg-white/5"
              }`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
                <img
                  src="/Seedance_2.0_-_Runway.png"
                  alt={model.name}
                  className="size-6 object-cover"
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-white">
                  {model.name}
                </span>
                <span className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                  <span className="flex items-center gap-0.5">
                    <Diamond className="size-2.5" />
                    {model.resolution}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-2.5" />
                    {model.duration}
                  </span>
                </span>
              </span>

              {isSelected && (
                <span className="flex shrink-0 items-center">
                  <Check className="size-4" style={{ color: "#00e5ff" }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

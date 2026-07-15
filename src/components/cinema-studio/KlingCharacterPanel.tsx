"use client";

import { X, Upload } from "lucide-react";

interface KlingCharacterPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KlingCharacterPanel({ isOpen, onClose }: KlingCharacterPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999999] flex items-end md:items-center justify-end md:justify-center bg-black/40 backdrop-blur-sm md:p-4">
      <div className="w-full md:w-96 max-h-[90vh] rounded-t-2xl md:rounded-2xl bg-[#0a0a0a] border border-[rgba(217,217,217,0.08)] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[rgba(217,217,217,0.08)]">
          <div>
            <h2 className="text-lg font-semibold text-white">Select Character</h2>
            <p className="text-xs text-neutral-500 mt-1">Upload or choose a character</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Character Upload */}
          <div>
            <label className="text-sm font-medium text-white mb-3 block">
              Upload Character
            </label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-[rgba(217,217,217,0.2)] rounded-lg p-8 cursor-pointer hover:border-[rgba(217,217,217,0.4)] transition-colors">
              <Upload className="size-8 text-neutral-400 mb-2" />
              <span className="text-sm text-neutral-400 text-center">
                Image with visible face and body
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
              />
            </label>
          </div>

          {/* Character Grid Placeholder */}
          <div>
            <label className="text-sm font-medium text-white mb-3 block">
              Available Characters
            </label>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(217,217,217,0.1)] flex items-center justify-center cursor-pointer hover:border-[rgba(217,217,217,0.3)] transition-colors"
                >
                  <span className="text-xs text-neutral-500">Character {i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[rgba(217,217,217,0.08)] p-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] text-white text-sm font-medium hover:bg-[rgba(255,255,255,0.1)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 px-4 py-2 rounded-lg bg-[#00e5ff] text-[#0a0a0a] text-sm font-medium hover:bg-[#00d4ff] transition-colors"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

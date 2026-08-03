"use client";

import { useState } from "react";
import { X, Upload } from "lucide-react";

interface KlingMotionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalTab = "upload" | "library";

export default function KlingMotionModal({ isOpen, onClose }: KlingMotionModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("upload");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] rounded-2xl bg-[#0a0a0a] border border-[rgba(217,217,217,0.08)] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[rgba(217,217,217,0.08)]">
          <div>
            <h2 className="text-lg font-semibold text-white">Copy Any Motion with</h2>
            <p className="text-sm text-neutral-400">Your Character</p>
            <p className="text-xs text-neutral-500 mt-1">
              Copy motion from any video and place your character into the same movement
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-6 border-b border-[rgba(217,217,217,0.08)]">
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === "upload"
                ? "text-[#D97757] border-b-2 border-[#D97757]"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("library")}
            className={`pb-3 text-sm font-medium transition-colors ${
              activeTab === "library"
                ? "text-[#D97757] border-b-2 border-[#D97757]"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            Motion Library
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "upload" && (
            <div className="space-y-6">
              {/* Motion Upload */}
              <div>
                <label className="text-sm font-medium text-white mb-3 block">
                  Add motion to copy
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[rgba(217,217,217,0.2)] rounded-lg p-8 cursor-pointer hover:border-[rgba(217,217,217,0.4)] transition-colors">
                  <Upload className="size-8 text-neutral-400 mb-2" />
                  <span className="text-sm text-neutral-400">
                    Video duration: 3–30 seconds
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                  />
                </label>
              </div>

              {/* Character Upload */}
              <div>
                <label className="text-sm font-medium text-white mb-3 block">
                  Add your character
                </label>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[rgba(217,217,217,0.2)] rounded-lg p-8 cursor-pointer hover:border-[rgba(217,217,217,0.4)] transition-colors">
                  <Upload className="size-8 text-neutral-400 mb-2" />
                  <span className="text-sm text-neutral-400">
                    Image with visible face and body
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === "library" && (
            <div className="flex items-center justify-center h-40">
              <p className="text-neutral-400">Motion Library coming soon</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[rgba(217,217,217,0.08)] p-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] text-white text-sm font-medium hover:bg-[rgba(255,255,255,0.1)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-[#00e5ff] text-[#0a0a0a] text-sm font-medium hover:bg-[#00d4ff] transition-colors"
          >
            Apply Motion
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { SlidersHorizontal, Upload, X } from "lucide-react";

// Shared assets picker for the reference's references / edit_video /
// edit_references call types (audit section 2.5): a fixed ~600x672 overlay
// at z-[900] with a transparent z-[899] click-catcher behind it. It sits to
// the right of the 20rem left panel and does NOT cover it.

const ASSET_TABS = [
  { value: "uploads", label: "Uploads", empty: "No uploads found" },
  { value: "elements", label: "Elements", empty: "No elements found" },
  {
    value: "image-generations",
    label: "Image Generations",
    empty: "No image generations found",
  },
  {
    value: "video-generations",
    label: "Video Generations",
    empty: "No video generations found",
  },
  {
    value: "audio-generations",
    label: "Audio Generations",
    empty: "No audio generations found",
  },
] as const;

type AssetTab = (typeof ASSET_TABS)[number]["value"];

interface VideoAssetsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  accept?: string;
  /** Tab the picker lands on each time it opens (Elements for the @ button). */
  defaultTab?: AssetTab;
  onSelectAsset: (name: string) => void;
}

export default function VideoAssetsPicker({
  isOpen,
  onClose,
  accept = "image/*,video/*,audio/*",
  defaultTab = "uploads",
  onSelectAsset,
}: VideoAssetsPickerProps) {
  const [activeTab, setActiveTab] = useState<AssetTab>(defaultTab);
  // Session-local uploads: names of files the user picked this session.
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-derive the active tab on the closed→open transition (React's
  // "adjusting state when a prop changes" pattern) so a caller that targets
  // a tab lands on it on every open, not just the first mount.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setActiveTab(defaultTab);
  }

  if (!isOpen) return null;

  const tab = ASSET_TABS.find((item) => item.value === activeTab)!;
  const showsUploads = activeTab === "uploads" && uploadedNames.length > 0;

  return (
    <>
      {/* Click-catcher behind the picker (reference: z-[899]). */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[899] bg-transparent"
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Assets picker"
        className="fixed left-3 top-1/2 z-[900] flex h-[672px] max-h-[calc(100vh-24px)] w-[600px] max-w-[calc(100vw-24px)] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#17191b] shadow-2xl shadow-black/60 lg:left-[344px]"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.07] px-3 pt-2">
          <div
            role="tablist"
            aria-label="Asset categories"
            className="hide-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto"
          >
            {ASSET_TABS.map((item) => {
              const selected = item.value === activeTab;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(item.value)}
                  className={`h-9 shrink-0 whitespace-nowrap border-b-2 px-2 text-xs font-medium transition-colors ${
                    selected
                      ? "border-b-white text-white"
                      : "border-b-transparent text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Close assets picker"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="flex shrink-0 items-center justify-between gap-2">
            {/* The active tab's title is repeated in the body. */}
            <h3 className="text-sm font-semibold text-white">{tab.label}</h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Filter"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <SlidersHorizontal className="size-3.5" />
                Filter
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#D97757] px-3 text-xs font-bold text-black transition-transform active:translate-y-px"
              >
                <Upload className="size-3.5" />
                Upload file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                accept={accept}
                aria-label="Upload file"
                onChange={(event) => {
                  const names = Array.from(event.target.files ?? []).map(
                    (file) => file.name,
                  );
                  if (names.length === 0) return;
                  setUploadedNames((current) => [...names, ...current]);
                  setActiveTab("uploads");
                  event.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {showsUploads ? (
              <div className="grid grid-cols-3 gap-2">
                {uploadedNames.map((name, index) => (
                  <button
                    key={`${name}-${index}`}
                    type="button"
                    onClick={() => {
                      onSelectAsset(name);
                      onClose();
                    }}
                    className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] p-2 text-center transition-colors hover:border-[#D97757]/55 hover:bg-[#D97757]/[0.06]"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.07] text-zinc-300">
                      <Upload className="size-4" />
                    </span>
                    <span className="w-full truncate text-[11px] font-medium text-zinc-200">
                      {name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[280px] items-center justify-center">
                <p className="text-sm text-zinc-500">{tab.empty}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

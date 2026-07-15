"use client";

import { useState } from "react";
import { X, Upload, Image as ImageIcon, Video, Heart } from "lucide-react";

interface AssetsPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "uploads" | "elements" | "imageGenerations" | "videoGenerations" | "liked";
  /** Reserved for callers (e.g. Kling 3.0 References, Kling 3.0 Turbo Start Frame) that assign the picked asset to a specific slot. */
  mode?: "default" | "startFrame" | "endFrame";
  /** Called with an object URL when an asset is picked. Only wired for callers that pass it. */
  onSelectAsset?: (url: string) => void;
  /** Restricts the Uploads file input (e.g. "image/*" for Kling 3.0 Turbo's image-only Start Frame). Defaults to the existing image+video behavior. */
  accept?: string;
}

type Tab = "uploads" | "elements" | "imageGenerations" | "videoGenerations" | "liked";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "uploads", label: "Uploads", icon: <Upload className="size-4" /> },
  { id: "elements", label: "Elements", icon: <ImageIcon className="size-4" /> },
  {
    id: "imageGenerations",
    label: "Image Generations",
    icon: <ImageIcon className="size-4" />,
  },
  {
    id: "videoGenerations",
    label: "Video Generations",
    icon: <Video className="size-4" />,
  },
  { id: "liked", label: "Liked", icon: <Heart className="size-4" /> },
];

const MODE_LABELS: Record<"startFrame" | "endFrame", string> = {
  startFrame: "Selecting: Start Frame",
  endFrame: "Selecting: End Frame",
};

export default function AssetsPickerModal({
  isOpen,
  onClose,
  defaultTab = "uploads",
  mode = "default",
  onSelectAsset,
  accept = "image/*,video/*",
}: AssetsPickerModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  if (!isOpen) return null;

  // Only wired when a caller passes onSelectAsset (e.g. Kling 3.0 References).
  // Other callers keep the prior fully-inert upload behavior.
  const handleSelectAsset = onSelectAsset
    ? (url: string) => {
        onSelectAsset(url);
        onClose();
      }
    : undefined;

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative h-[600px] w-[800px] rounded-[24px] border border-white/10 bg-[rgba(24,26,30,0.95)] shadow-2xl backdrop-blur-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        {mode !== "default" && (
          <div className="absolute left-6 top-4 z-10 text-xs font-medium text-[#00e5ff]">
            {MODE_LABELS[mode]}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-[#00e5ff] text-[#00e5ff]"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(600px-60px)]">
          {activeTab === "uploads" && (
            <UploadsTab onSelectAsset={handleSelectAsset} accept={accept} />
          )}
          {activeTab === "elements" && <ElementsTab />}
          {activeTab === "imageGenerations" && (
            <EmptyTab label="No image generations yet" />
          )}
          {activeTab === "videoGenerations" && (
            <EmptyTab label="No video generations yet" />
          )}
          {activeTab === "liked" && <EmptyTab label="No liked assets yet" />}
        </div>
      </div>
    </div>
  );
}

function UploadsTab({
  onSelectAsset,
  accept = "image/*,video/*",
}: {
  onSelectAsset?: (url: string) => void;
  accept?: string;
}) {
  const [hasUploads] = useState(false);

  return (
    <div className="p-6">
      {!hasUploads ? (
        <>
          {/* Upload Card */}
          <div className="mb-6 rounded-lg border-2 border-dashed border-white/10 p-6 hover:border-white/20 transition-colors">
            <label className="flex flex-col items-center justify-center gap-3 cursor-pointer">
              <Upload className="size-8 text-neutral-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-white">Upload media</p>
                <p className="text-xs text-neutral-500">PNG, JPG, MP4, WebM</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept={accept}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && onSelectAsset) onSelectAsset(URL.createObjectURL(file));
                }}
              />
            </label>
          </div>

          {/* Protected content note */}
          <p className="text-xs text-neutral-500 mb-4">
            Protected content is not allowed
          </p>

          {/* Empty state */}
          <div className="rounded-lg bg-white/5 p-6 text-center">
            <p className="text-sm text-neutral-400">No uploads found</p>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {/* Upload previews would go here */}
        </div>
      )}
    </div>
  );
}

function ElementsTab() {
  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-48 border-r border-white/10 p-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-neutral-400 px-3 py-2 uppercase">
            My Elements
          </div>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-neutral-300 hover:bg-white/5 transition-colors">
            Pinned
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-neutral-300 hover:bg-white/5 transition-colors">
            All
          </button>

          <div className="text-xs font-semibold text-neutral-400 px-3 py-2 uppercase mt-4">
            Projects
          </div>
          <div className="px-3 py-2 rounded-lg text-sm text-neutral-500 text-center">
            No projects found
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 p-6">
        <div className="text-center text-neutral-500">
          <p className="text-sm">Select a category to view elements</p>
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-500">{label}</p>
    </div>
  );
}

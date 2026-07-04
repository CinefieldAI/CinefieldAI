"use client";

import { useState, useRef, ReactNode } from "react";
import { Upload, X, Heart, ImageIcon } from "lucide-react";

export interface UploadedMedia {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  type: string;
  size: number;
}

interface MediaAttachPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach: (media: UploadedMedia[]) => void;
}

type MediaTab = "uploads" | "imageGenerations" | "liked";

export default function MediaAttachPanel({
  isOpen,
  onClose,
  onAttach,
}: MediaAttachPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<MediaTab>("uploads");
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    new Set()
  );
  const [error, setError] = useState<string>("");

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (!files) return;

    setError("");
    const validMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];

    Array.from(files).forEach((file) => {
      if (!validMimeTypes.includes(file.type)) {
        setError(
          "Unsupported file type. Please upload JPG, PNG, WEBP, HEIC, or HEIF."
        );
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      const newMedia: UploadedMedia = {
        id: Math.random().toString(36).substring(2),
        file,
        previewUrl,
        name: file.name,
        type: file.type,
        size: file.size,
      };

      setUploadedMedia((prev) => [...prev, newMedia]);
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toggleMediaSelection = (id: string) => {
    const newSet = new Set(selectedMediaIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedMediaIds(newSet);
  };

  const handleAttach = () => {
    const selectedItems = uploadedMedia.filter((media) =>
      selectedMediaIds.has(media.id)
    );
    if (selectedItems.length > 0) {
      onAttach(selectedItems);
      onClose();
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const TabButton = ({
    tab,
    label,
  }: {
    tab: MediaTab;
    label: string;
  }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-full text-xs font-medium transition-colors ${
        activeTab === tab
          ? "bg-white/20 text-white"
          : "bg-white/5 text-white/60 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  const EmptyState = ({
    icon: Icon,
    title,
    description,
  }: {
    icon: React.ReactNode;
    title: string;
    description: string;
  }) => (
    <div className="flex h-full items-center justify-center flex-col gap-4">
      <div className="text-white/30">{Icon}</div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-white/60">{description}</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed z-[999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(720px,calc(100vw-48px))] h-[min(560px,calc(100vh-48px))] rounded-[24px] border border-white/10 bg-[#0f1b15] text-white shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER WITH TABS AND CLOSE */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
          {/* Tabs */}
          <div className="flex gap-2">
            <TabButton tab="uploads" label="Uploads" />
            <TabButton
              tab="imageGenerations"
              label="Image Generations"
            />
            <TabButton tab="liked" label="Liked" />
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* Uploads Tab */}
          {activeTab === "uploads" && (
            <div className="flex-1 overflow-y-auto p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Upload Media Tile */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/8 transition-colors cursor-pointer aspect-square"
                >
                  <Upload className="h-8 w-8 text-white/50" />
                  <div className="text-center">
                    <p className="text-xs font-medium text-white">
                      Upload media
                    </p>
                    <p className="text-[10px] text-white/50 mt-1">
                      Protected content is not allowed
                    </p>
                  </div>
                </button>

                {/* Uploaded Media Thumbnails */}
                {uploadedMedia.map((media) => {
                  const isSelected = selectedMediaIds.has(media.id);
                  return (
                    <button
                      key={media.id}
                      onClick={() => toggleMediaSelection(media.id)}
                      className={`relative rounded-2xl overflow-hidden aspect-square transition-all ${
                        isSelected
                          ? "ring-2 ring-cyan-400"
                          : "hover:ring-1 hover:ring-white/50"
                      }`}
                    >
                      <img
                        src={media.previewUrl}
                        alt={media.name}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-cyan-400/20 flex items-center justify-center">
                          <div className="w-6 h-6 rounded-full bg-cyan-400 flex items-center justify-center">
                            <span className="text-white text-sm font-bold">
                              ✓
                            </span>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Image Generations Tab */}
          {activeTab === "imageGenerations" && (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<ImageIcon className="h-12 w-12" />}
                title="No generations yet"
                description="Start generating images and they will appear here"
              />
            </div>
          )}

          {/* Liked Tab */}
          {activeTab === "liked" && (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<Heart className="h-12 w-12" />}
                title="No liked images yet"
                description="Like your image generations and they will appear here"
              />
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/5">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAttach}
            disabled={selectedMediaIds.size === 0}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedMediaIds.size === 0
                ? "bg-white/5 text-white/50 cursor-not-allowed"
                : "bg-cyan-400 text-black hover:bg-cyan-300"
            }`}
          >
            Attach
          </button>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    </>
  );
}

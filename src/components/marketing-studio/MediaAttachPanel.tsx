"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { X, Heart, ImageIcon } from "lucide-react";

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
  promptBarDock?: "top" | "bottom";
}

type MediaTab = "uploads" | "imageGenerations" | "liked";

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center flex-col gap-4">
      <div className="text-white/30">{icon}</div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-white/60">{description}</p>
      </div>
    </div>
  );
}

export default function MediaAttachPanel({
  isOpen,
  onClose,
  onAttach,
  promptBarDock = "bottom",
}: MediaAttachPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<MediaTab>("uploads");
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

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
        setError("Unsupported file type. Please upload JPG, PNG, WEBP, HEIC, or HEIF.");
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
    const selectedItems = uploadedMedia.filter((media) => selectedMediaIds.has(media.id));
    if (selectedItems.length > 0) {
      onAttach(selectedItems);
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in duration-300"
        onClick={onClose}
      />

      {/* Main Panel Container */}
      <div
        className={`fixed z-[999] left-1/2 -translate-x-1/2 w-[min(720px,calc(100vw-48px))] h-[522px] rounded-3xl border border-white/10 bg-[#131517] text-white shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ease-out animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 ${
          promptBarDock === "bottom" ? "bottom-[140px]" : "top-[325px]"
        }`}
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CLOSE BUTTON */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2.5 right-2.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>

        {/* INNER GRADIENT CARD WRAPPER */}
        <div className="min-h-0 flex-1 p-2">
          <div className="flex flex-col h-full overflow-hidden gap-2 p-1.5 rounded-[20px] backdrop-blur-[20px] shadow-[0_12px_8px_0_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(255,255,255,0.08)] bg-[linear-gradient(0deg,rgba(21,21,21,0.88)_0%,rgba(21,21,21,0.88)_100%),linear-gradient(41deg,rgba(101,189,235,0.24)_25.53%,rgba(101,189,235,0.00)_63.06%)]">
            {/* TABS */}
            <div className="flex h-9 items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("uploads")}
                className={`text-xs font-medium border h-7 px-3 py-1 rounded-full transition-all duration-300 ease-out whitespace-nowrap shrink-0 text-center ${
                  activeTab === "uploads"
                    ? "bg-white text-black border-transparent font-semibold shadow-sm"
                    : "bg-white/5 text-white/70 border-transparent hover:bg-white/10 hover:text-white"
                }`}
              >
                Uploads
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("imageGenerations")}
                className={`text-xs font-medium border h-7 px-3 py-1 rounded-full transition-all duration-300 ease-out whitespace-nowrap shrink-0 text-center ${
                  activeTab === "imageGenerations"
                    ? "bg-white text-black border-transparent font-semibold shadow-sm"
                    : "bg-white/5 text-white/70 border-transparent hover:bg-white/10 hover:text-white"
                }`}
              >
                Image Generations
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("liked")}
                className={`text-xs font-medium border h-7 px-3 py-1 rounded-full transition-all duration-300 ease-out whitespace-nowrap shrink-0 text-center ${
                  activeTab === "liked"
                    ? "bg-white text-black border-transparent font-semibold shadow-sm"
                    : "bg-white/5 text-white/70 border-transparent hover:bg-white/10 hover:text-white"
                }`}
              >
                Liked
              </button>
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-auto rounded-2xl bg-white/[0.03] p-2">
              {error && (
                <div className="mb-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-xs text-red-200">
                  {error}
                </div>
              )}

              {activeTab === "uploads" && (
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}>
                  {/* UPLOAD TILE CARD */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="relative overflow-clip col-span-2 min-h-[110px] rounded-2xl bg-white/5 border border-white/5 transition-colors cursor-pointer hover:bg-white/10 flex flex-col justify-between"
                  >
                    <div className="flex flex-col items-center justify-center gap-1.5 flex-1 p-4">
                      <div className="flex shrink-0 items-center justify-center rounded-full bg-white/10 text-white/90 shadow-[0_10px_21px_rgba(0,0,0,0.2),inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors size-8">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="size-5">
                          <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M12 5.25V12m0 0v6.75M12 12H5.25M12 12h6.75" />
                        </svg>
                      </div>
                      <span className="text-xs font-semibold text-white">Upload media</span>
                    </div>

                    <div className="flex items-center justify-center gap-1 bg-white/5 rounded-t-[4px] px-2 py-1.5">
                      <svg className="size-3 shrink-0 text-white/50" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.2618 2 12 2ZM10 11C10 10.5858 10.3358 10.25 10.75 10.25H12C12.4142 10.25 12.75 10.5858 12.75 11L12.75 16.25C12.75 16.6642 12.4142 17 12 17C11.5858 17 11.25 16.6642 11.25 16.25L11.25 11.75H10.75C10.3358 11.75 10 11.4142 10 11ZM12 7.25C11.5858 7.25 11.25 7.58579 11.25 8C11.25 8.41421 11.5858 8.75 12 8.75C12.4142 8.75 12.75 8.41421 12.75 8C12.75 7.58579 12.4142 7.25 12 7.25Z" fill="currentColor" />
                      </svg>
                      <span className="text-[10px] font-medium text-white/50">Protected content is not allowed</span>
                    </div>
                  </div>

                  {/* UPLOADED MEDIA ITEMS */}
                  {uploadedMedia.map((media) => {
                    const isSelected = selectedMediaIds.has(media.id);
                    return (
                      <div
                        key={media.id}
                        onClick={() => toggleMediaSelection(media.id)}
                        className={`relative rounded-2xl overflow-hidden aspect-square cursor-pointer transition-all ${
                          isSelected ? "ring-2 ring-[#d97757]" : "hover:ring-1 hover:ring-white/40"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={media.previewUrl} alt={media.name} className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-[#d97757]/30 flex items-center justify-center">
                            <div className="w-6 h-6 rounded-full bg-[#d97757] text-black flex items-center justify-center font-bold text-xs">
                              ✓
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === "imageGenerations" && (
                <EmptyState
                  icon={<ImageIcon className="h-10 w-10" />}
                  title="No image generations"
                  description="Your generated images will appear here"
                />
              )}

              {activeTab === "liked" && (
                <EmptyState
                  icon={<Heart className="h-10 w-10" />}
                  title="No liked items"
                  description="Your liked images will appear here"
                />
              )}
            </div>
          </div>
        </div>

        {/* FOOTER BAR */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium text-xs min-w-[96px] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={selectedMediaIds.size === 0}
            className={`px-4 py-2 rounded-xl font-semibold text-xs min-w-[96px] transition-colors ${
              selectedMediaIds.size === 0
                ? "bg-white/10 text-white/40 cursor-not-allowed"
                : "bg-white text-black hover:bg-white/90"
            }`}
          >
            Attach
          </button>
        </div>

        {/* HIDDEN FILE INPUT */}
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

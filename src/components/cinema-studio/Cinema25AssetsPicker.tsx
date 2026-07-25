"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, SlidersHorizontal, Plus, Images, Heart } from "lucide-react";

/** Which target the picked asset gets assigned to. */
export type Cinema25PickerContext = "reference" | "startFrame" | "endFrame";

type Tab = "uploads" | "imageGenerations" | "liked";

const TABS: { id: Tab; label: string }[] = [
  { id: "uploads", label: "Uploads" },
  { id: "imageGenerations", label: "Image Generations" },
  { id: "liked", label: "Liked" },
];

const ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif";

interface Cinema25AssetsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which entry point opened it — determines where a picked asset is assigned. */
  context: Cinema25PickerContext | null;
  /** Called with an object URL when an asset is selected/uploaded. */
  onSelectAsset: (url: string) => void;
}

/**
 * Shared Cinema Studio 2.5 Assets Picker — one centered application modal for
 * all five entry points (As Reference / As Start Frame / As End Frame + the
 * Start Frame / End Frame cards). The `context` tells it which target to assign
 * the picked asset to. Matches the Higgsfield reference surface exactly.
 */
export default function Cinema25AssetsPicker({
  isOpen,
  onClose,
  context,
  onSelectAsset,
}: Cinema25AssetsPickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("uploads");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset to the Uploads tab each time the picker is opened.
  useEffect(() => {
    if (isOpen) setActiveTab("uploads");
  }, [isOpen]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      onSelectAsset(URL.createObjectURL(file));
      onClose();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999998] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-label="Assets picker"
          className="fixed left-1/2 top-1/2 z-[999999] -translate-x-1/2 -translate-y-1/2 focus:outline-none"
        >
          <div
            data-ignore-marquee="true"
            data-assets-picker="true"
            className="pointer-events-auto relative flex h-dvh min-h-[420px] w-[min(960px,calc(100vw-32px))] flex-col gap-1 overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.05)] bg-[rgba(35,38,42,0.75)] p-2 shadow-[0_12px_20px_rgba(0,0,0,0.24)] backdrop-blur-[40px] md:h-[var(--assets-picker-surface-height)]"
            style={
              {
                "--assets-picker-surface-height": "min(672px, calc(100vh - 32px))",
                width: "min(960px, calc(100vw - 32px))",
              } as React.CSSProperties
            }
          >
            {/* Header: tabs + close */}
            <div className="flex w-full items-center gap-3 px-2 py-1">
              <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {TABS.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-semibold leading-4 tracking-[0.2px] transition-colors ${
                        active
                          ? "bg-white text-[#181a1e] shadow-[0_1px_2px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.6)]"
                          : "bg-transparent text-white hover:bg-white/5"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close assets picker"
                className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white transition-colors hover:bg-white/10"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-white/[0.03]">
              {activeTab === "uploads" && (
                <div className="flex h-full flex-col">
                  {/* Section header */}
                  <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/5 p-2">
                    <span className="px-1 text-[12px] font-semibold leading-4 text-white/60">
                      Uploads
                    </span>
                    <button
                      type="button"
                      className="flex h-7 items-center gap-1.5 rounded-[10px] bg-white/5 px-2 text-[12px] font-medium text-white transition-colors hover:bg-white/10"
                    >
                      <SlidersHorizontal className="size-4" />
                      Filter
                    </button>
                  </div>

                  {/* Media grid */}
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    <div className="grid grid-cols-4 gap-2">
                      {/* Upload media card — spans two columns */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="col-span-2 flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/[0.06]"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white">
                          <Plus className="size-4" />
                        </span>
                        <span className="text-[12px] font-medium text-white">Upload media</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={handleFile}
                      />
                    </div>

                    {/* Empty state */}
                    <div className="flex items-center justify-center py-10">
                      <p className="text-[12px] text-white/40">No uploads found</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "imageGenerations" && (
                <EmptyState
                  tone="blue"
                  icon={<Images className="size-5 text-white" />}
                  title="Your image generations will appear here"
                  description="Generate images to see them here"
                />
              )}

              {activeTab === "liked" && (
                <EmptyState
                  tone="pink"
                  icon={<Heart className="size-5 text-white" fill="currentColor" />}
                  title="Your favorite generations will appear here"
                  description="Mark the ones you like to save them here"
                />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EmptyState({
  tone,
  icon,
  title,
  description,
}: {
  tone: "blue" | "pink";
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const gradient =
    tone === "blue"
      ? "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)"
      : "linear-gradient(135deg, #EC4899 0%, #BE185D 100%)";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-[12px]"
        style={{
          background: gradient,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px rgba(0,0,0,0.24)",
        }}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-white/80">{title}</p>
        <p className="text-xs text-white/40">{description}</p>
      </div>
    </div>
  );
}

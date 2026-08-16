"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { List, Plus, X } from "lucide-react";

/**
 * Cinema Studio 4.0's own Assets picker — transcribed from the reference's
 * "Assets v2" dialog (two tab tiers: References/Elements/Generations/Liked
 * on top, Recent/All/Images/Videos/Audio below, plus a Sort by button).
 * Distinct from Cinema25AssetsPicker (single-tier, used by Cinema Studio
 * 2.5/3.0/3.5) — Cinefield's asset backend only has one real capability
 * either picker can offer (upload a local file), so every tab beyond the
 * References/Uploads one renders the same honest "nothing here yet" state
 * rather than a fabricated library. "Sort by" is rendered inert for the
 * same reason — there is nothing real to sort yet.
 *
 * Unlike Cinema25AssetsPicker, this one does NOT close after a file is
 * picked (References is a 0/50 multi-add counter, not a single slot) and
 * its upload input accepts multiple files at once, matching the
 * reference's own `multiple` file input.
 */

const ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif";

type TopTab = "references" | "elements" | "generations" | "liked";
type ContentTab = "recent" | "all" | "images" | "videos" | "audio";

const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: "references", label: "References" },
  { id: "elements", label: "Elements" },
  { id: "generations", label: "Generations" },
  { id: "liked", label: "Liked" },
];

const CONTENT_TABS: { id: ContentTab; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "audio", label: "Audio" },
];

interface Cinema40AssetsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab: TopTab;
  /** Called once per file picked. Caller enforces the 0/50 cap. */
  onSelectAsset: (url: string) => void;
}

export default function Cinema40AssetsPicker({
  isOpen,
  onClose,
  initialTab,
  onSelectAsset,
}: Cinema40AssetsPickerProps) {
  const [topTab, setTopTab] = useState<TopTab>(initialTab);
  const [contentTab, setContentTab] = useState<ContentTab>("recent");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset to the requested tab each time the picker opens — same
  // adjust-during-render pattern Cinema25AssetsPicker uses.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setTopTab(initialTab);
      setContentTab("recent");
    }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Copy the picked files out before clearing the input — resetting
    // .value also clears the live FileList it came from, so reading it
    // after the reset (as this used to) silently dropped every file.
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    for (const file of files) {
      onSelectAsset(URL.createObjectURL(file));
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[1000] flex items-center justify-center outline-none"
        >
          <Dialog.Title className="sr-only">Assets</Dialog.Title>
          <div
            data-ignore-marquee="true"
            data-assets-picker="true"
            className="relative flex min-h-[420px] w-[min(960px,calc(100vw-32px))] flex-col gap-1 overflow-hidden rounded-[24px] bg-[rgba(35,38,42,0.75)] px-1 pt-1 pb-1 shadow-[0_32px_24px_0_rgba(0,0,0,0.15),0_6px_4px_0_rgba(0,0,0,0.25)] backdrop-blur-[40px]"
            style={{ height: "min(598px, calc(100vh - 32px))" }}
          >
            {/* Header: top-tier tabs + close */}
            <header className="flex w-full shrink-0 items-center gap-3 px-2 py-1">
              <div className="hide-scrollbar min-w-0 flex-1 overflow-x-auto">
                <div role="tablist" className="flex w-max min-w-full items-center gap-1">
                  {TOP_TABS.map((tab) => {
                    const active = topTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setTopTab(tab.id)}
                        className={`flex h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-semibold leading-4 tracking-[0.2px] transition-colors ${
                          active ? "bg-white text-[#181a1e]" : "bg-transparent text-white hover:bg-white/5"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close assets picker"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white transition-colors hover:bg-white/10"
                >
                  <X className="size-4" strokeWidth={1.5} />
                </button>
              </Dialog.Close>
            </header>

            {/* Second tier: content-type tabs + Sort by, then the grid */}
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden rounded-2xl">
              <div className="flex h-12 shrink-0 items-center bg-white/[0.03] px-2">
                <div className="hide-scrollbar min-w-0 flex-1 overflow-x-auto">
                  <div role="tablist" className="flex w-max items-center gap-1">
                    {CONTENT_TABS.map((tab) => {
                      const active = contentTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setContentTab(tab.id)}
                          className={`flex h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
                            active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  disabled
                  aria-label="Sort by (not available yet)"
                  className="flex h-8 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-white/30"
                >
                  <List className="size-4" strokeWidth={1.5} />
                  Sort by
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-white/[0.03] p-3">
                <div className="grid grid-cols-6 gap-2">
                  {topTab === "references" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Upload media"
                        className="flex aspect-square flex-col overflow-hidden rounded-[10px] border border-dashed border-white/20 bg-white/5 transition-colors hover:bg-white/10"
                      >
                        <span className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                          <span className="flex items-center justify-center rounded-full border border-white/20 bg-white/5 p-2.5 shadow-[0_20.5px_20.5px_0_rgba(0,0,0,0.09),inset_0_-0.3px_5.4px_0_rgba(185,185,185,0.35)]">
                            <Plus className="size-5 text-white" strokeWidth={1.5} />
                          </span>
                          <span className="text-center text-xs font-medium text-white">Upload media</span>
                        </span>
                        <span className="flex shrink-0 items-start gap-1 rounded-t-[4px] bg-white/5 px-1.5 pb-2 pt-1.5">
                          <span className="line-clamp-2 min-w-0 text-left text-[9px] font-medium leading-[11px] text-white/50">
                            Protected content is not allowed
                          </span>
                        </span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPT}
                        multiple
                        className="hidden"
                        onChange={handleFiles}
                      />
                    </>
                  ) : (
                    <div className="col-span-6 flex flex-col items-center justify-center gap-1 py-10 text-center">
                      <p className="text-sm font-medium text-white/70">
                        Nothing here yet
                      </p>
                      <p className="max-w-[240px] text-xs text-white/40">
                        {topTab === "elements" && "Reusable elements aren't wired up yet."}
                        {topTab === "generations" && "Your generations will appear here."}
                        {topTab === "liked" && "Items you like will appear here."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

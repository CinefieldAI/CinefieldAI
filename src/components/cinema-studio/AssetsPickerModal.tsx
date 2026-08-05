"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Filter,
  History,
  Image as ImageIcon,
  ListFilter,
  Plus,
  SortAsc,
  Upload,
  Video,
  Heart,
  X,
} from "lucide-react";

interface AssetsPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "uploads" | "elements" | "imageGenerations" | "videoGenerations" | "liked";
  /** Reserved for callers (e.g. Kling 3.0 References, Kling 3.0 Turbo Start Frame) that assign the picked asset to a specific slot. */
  mode?: "default" | "startFrame" | "endFrame" | "videoReference";
  /** Called with an object URL when an asset is picked. Only wired for callers that pass it. */
  onSelectAsset?: (url: string) => void;
  /** Restricts the Uploads file input (e.g. "image/*" for Kling 3.0 Turbo's image-only Start Frame). Defaults to the existing image+video behavior. */
  accept?: string;
  variant?: "default" | "geminiOmniFlash";
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

const MODE_LABELS: Record<"startFrame" | "endFrame" | "videoReference", string> = {
  startFrame: "Selecting: Start Frame",
  endFrame: "Selecting: End Frame",
  videoReference: "Selecting: Video Reference",
};

export default function AssetsPickerModal({
  isOpen,
  onClose,
  defaultTab = "uploads",
  mode = "default",
  onSelectAsset,
  accept = "image/*,video/*",
  variant = "default",
}: AssetsPickerModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  // This modal is mounted once and toggled via `isOpen` rather than being
  // conditionally rendered, so `useState(defaultTab)` only captures the
  // initial value. Re-derive the active tab during render on the
  // closed→open transition (React's recommended "adjusting state when a
  // prop changes" pattern) so callers targeting a specific tab (e.g.
  // Elements) land on the correct one, without altering any other
  // tab/navigation behavior.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setActiveTab(defaultTab);
  }

  if (!isOpen) return null;

  if (variant === "geminiOmniFlash") {
    return (
      <GeminiAssetsPicker
        onClose={onClose}
        accept={accept}
        onSelectAsset={onSelectAsset}
      />
    );
  }

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
        data-assets-picker="true"
        className="relative h-[600px] w-[800px] rounded-[24px] border border-white/10 bg-[rgba(24,26,30,0.95)] shadow-2xl backdrop-blur-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: mode badge + tabs + close */}
        <div className="flex flex-col border-b border-white/10 px-5 pt-3">
          <div className="flex items-center justify-between pb-1.5">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Assets Library
              </span>
              {mode !== "default" && (
                <span className="rounded-full bg-[#D97757]/20 border border-[#D97757]/40 px-2.5 py-0.5 text-[11px] font-extrabold uppercase text-[#D97757]">
                  {MODE_LABELS[mode]}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close assets picker"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1">
            {(mode === "startFrame" || mode === "endFrame" ? TABS.filter(t => t.id === "uploads" || t.id === "imageGenerations" || t.id === "liked") : TABS).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "border-b-2 border-[#D97757] text-[#D97757] font-bold"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
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

type GeminiTab = "uploads" | "imageGenerations" | "videoGenerations" | "liked";
type SortOption = "lastCreated" | "lastUsed" | "firstCreated";
type MediaFilter = "all" | "images" | "videos";

const GEMINI_TABS: { id: GeminiTab; label: string }[] = [
  { id: "uploads", label: "Uploads" },
  { id: "imageGenerations", label: "Image Generations" },
  { id: "videoGenerations", label: "Video Generations" },
  { id: "liked", label: "Liked" },
];

function GeminiAssetsPicker({
  onClose,
  accept,
  onSelectAsset,
}: {
  onClose: () => void;
  accept: string;
  onSelectAsset?: (url: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<GeminiTab>("uploads");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>("lastCreated");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageOnly = accept === "image/*";
  const tabs = imageOnly
    ? GEMINI_TABS.filter((tab) => tab.id !== "videoGenerations")
    : GEMINI_TABS;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const sectionLabel =
    tabs.find((tab) => tab.id === activeTab)?.label ?? "Uploads";

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Assets picker"
        tabIndex={-1}
        data-assets-picker="true"
        className="flex h-[min(680px,calc(100dvh-24px))] w-[min(800px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#292c2f]/95 shadow-2xl shadow-black/60 outline-none backdrop-blur-2xl"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3">
          <div role="tablist" aria-label="Asset sources" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-8 shrink-0 rounded-full px-4 text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "bg-white text-[#1c1e20] shadow-[inset_0_1px_0_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.18)]"
                    : "text-white hover:bg-white/[0.06]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assets picker"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="relative flex h-11 shrink-0 items-center justify-between border-b border-white/[0.04] px-4">
          <span className="text-xs font-semibold text-zinc-400">
            {sectionLabel}
          </span>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            className={`flex h-7 items-center gap-1.5 rounded-[10px] px-3 text-xs font-semibold text-zinc-200 ${
              filterOpen ? "bg-white/10" : "bg-white/[0.06] hover:bg-white/[0.09]"
            }`}
          >
            <Filter className="size-3.5" />
            Filter
          </button>

          {filterOpen && (
            <div
              role="menu"
              aria-label="Asset filters"
              className="absolute right-4 top-[38px] z-20 w-[188px] rounded-2xl border border-white/[0.07] bg-[#24272a]/95 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl"
            >
              <FilterSectionLabel>Sort by</FilterSectionLabel>
              <FilterItem
                icon={CalendarClock}
                label="Last created"
                selected={sort === "lastCreated"}
                onClick={() => setSort("lastCreated")}
              />
              <FilterItem
                icon={History}
                label="Last used"
                selected={sort === "lastUsed"}
                onClick={() => setSort("lastUsed")}
              />
              <FilterItem
                icon={SortAsc}
                label="First created"
                selected={sort === "firstCreated"}
                onClick={() => setSort("firstCreated")}
              />
              <FilterSectionLabel>Filter by</FilterSectionLabel>
              <FilterItem
                label="All media"
                selected={mediaFilter === "all"}
                onClick={() => setMediaFilter("all")}
              />
              <FilterItem
                icon={ImageIcon}
                label="Images"
                selected={mediaFilter === "images"}
                onClick={() => setMediaFilter("images")}
              />
              {!imageOnly && (
                <FilterItem
                  icon={Video}
                  label="Videos"
                  selected={mediaFilter === "videos"}
                  onClick={() => setMediaFilter("videos")}
                />
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === "uploads" ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[134px] w-[278px] max-w-full flex-col items-center justify-center rounded-xl border border-white/[0.04] bg-white/[0.05] text-white transition-colors hover:bg-white/10"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                  <Plus className="size-5 text-zinc-500" />
                </span>
                <span className="mt-3 text-sm font-semibold">Upload media</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                name="gemini-assets-upload"
                accept={accept}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && onSelectAsset) {
                    onSelectAsset(URL.createObjectURL(file));
                    onClose();
                  }
                }}
              />
              <p className="mt-6 text-center text-sm text-zinc-500">
                No uploads found
              </p>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              {activeTab === "imageGenerations"
                ? "No image generations yet"
                : activeTab === "videoGenerations"
                  ? "No video generations yet"
                  : "No liked assets yet"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center px-2 text-xs text-zinc-500">
      {children}
    </div>
  );
}

function FilterItem({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon?: typeof ListFilter;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-medium text-white hover:bg-white/[0.05]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {Icon && <Icon className="size-4 text-zinc-300" />}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      {selected && <Check className="size-4 text-[#d1fe17]" />}
    </button>
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

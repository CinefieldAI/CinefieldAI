"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

interface PresetItem {
  id: string;
  title: string;
  categories: string[];
}

interface MotionPresetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset: (preset: string) => void;
  /** Matches a preset's `title`. Only used when `categories` is also passed (see below). */
  selectedPreset?: string;
  /**
   * Overrides the default Minimax/Kling category set — e.g. Seedance Pro Fast's
   * ["All","UGC","Viral","Commercial","Effects"]. Passing this also reveals the
   * search field and the selection ring; omitted, the panel is byte-for-byte
   * identical to its original Minimax/Kling behavior.
   */
  categories?: string[];
  /** Overrides the default single "General" preset — only used alongside `categories`. */
  presets?: PresetItem[];
}

/**
 * "GENERAL" tile's presets panel (Minimax Hailuo family, every Kling GENERAL tile,
 * and now Seedance Pro Fast). Categories are confirmed verbatim from a live
 * click-audit ("Generation settings All Horror Viral Camera Control Effects UGC
 * Action Movement Emotions Commercial ..."). The preset grid itself only lists
 * "General" — the remaining ~30 preset names captured in that audit are run
 * together as concatenated DOM text with no reliable word boundaries (e.g.
 * "...MONEY RAIN WIREFRAME TRAIN RUSH..."), so they are deliberately NOT guessed
 * at here rather than risking fabricated preset names. No local preset
 * thumbnail/video assets exist yet, so each card is a solid-background label
 * card (no remote URLs). Seedance Pro Fast's named presets (Outfit Check,
 * Selfie, Crying, etc.) have the same problem — no real preview assets exist
 * in this codebase — so only "General" is rendered for it too, tagged under
 * its own 5-category set.
 */
const DEFAULT_CATEGORIES = [
  "All",
  "Horror",
  "Viral",
  "Camera Control",
  "Effects",
  "UGC",
  "Action",
  "Movement",
  "Emotions",
  "Commercial",
];

const DEFAULT_PRESETS: PresetItem[] = [{ id: "general", title: "General", categories: ["All"] }];

export default function MotionPresetsPanel({
  isOpen,
  onClose,
  onSelectPreset,
  selectedPreset = "General",
  categories,
  presets,
}: MotionPresetsPanelProps) {
  const activeCategories = categories ?? DEFAULT_CATEGORIES;
  const activePresets = presets ?? DEFAULT_PRESETS;
  const showSearchAndSelection = Boolean(categories);

  const [activeCategory, setActiveCategory] = useState(activeCategories[0]);
  const [query, setQuery] = useState("");

  if (!isOpen) return null;

  const visiblePresets = activePresets.filter((preset) => {
    const inCategory = activeCategory === "All" || preset.categories.includes(activeCategory);
    const q = query.trim().toLowerCase();
    const matchesQuery = q === "" || preset.title.toLowerCase().includes(q);
    return inCategory && matchesQuery;
  });

  // Portalled to the body: the prompt bar animates in on a transform, and a
  // transformed ancestor becomes the containing block for position:fixed, so
  // "inset-0" resolved to the bar's own box and this opened behind the navbar.
  return createPortal(
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="motion-presets-title"
        className="relative w-[min(960px,calc(100vw-32px))] max-h-[min(40rem,calc(100vh-32px))] overflow-hidden rounded-2xl border border-white/10 bg-[rgba(24,26,30,0.98)] p-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preset panel"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        <h2 id="motion-presets-title" className="px-3 pt-3 text-sm font-semibold text-white">
          Generation settings
        </h2>

        <div className="mt-3 flex items-center justify-between gap-3 px-3">
          <nav className="hide-scrollbar flex items-center gap-1 overflow-x-auto">
            {activeCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`h-8 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors ${
                  activeCategory === cat
                    ? "border-white/10 bg-white/10 text-white"
                    : "border-transparent text-neutral-400 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </nav>

          {showSearchAndSelection && (
            <div className="relative w-48 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search presets..."
                className="h-8 w-48 rounded-lg border border-divider-secondary bg-white/4 py-1.5 pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-secondary focus-within:border-white/40"
              />
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-3 overflow-y-auto p-3 sm:grid-cols-5 md:grid-cols-6">
          {visiblePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={showSearchAndSelection ? selectedPreset === preset.title : undefined}
              onClick={() => {
                onSelectPreset(preset.title);
                onClose();
              }}
              className={`flex aspect-square flex-col items-start justify-end rounded-xl bg-[#2E3132] p-2 text-left transition-colors hover:bg-[#383b3c] ${
                showSearchAndSelection
                  ? `ring-inset ring-primary-60 ${selectedPreset === preset.title ? "ring-4" : "ring-0"}`
                  : ""
              }`}
            >
              <p className="text-[11px] font-bold uppercase leading-tight text-white">{preset.title}</p>
            </button>
          ))}
          {visiblePresets.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-neutral-500">No presets found</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

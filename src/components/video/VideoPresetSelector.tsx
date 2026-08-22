"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

// The preset selector the preview card's "Change" button opens (audit
// section 2.2). It fills the RIGHT COLUMN — not a popover or modal — while
// the 20rem left panel stays put. "Mix" (Cinefield family only) opens the
// SAME selector in second-motion mode (the reference's for=second-motion:
// a second preset blended into the current one at strength 0.85).

// Horizontal model chip strip — clicking a chip filters the preset grid.
// Names follow the audit's chip list (Higgsfield → Cinefield).
const MODEL_CHIPS: { name: string; isNew?: boolean }[] = [
  { name: "Seedance 2.5", isNew: true },
  { name: "FLUX.3 Video", isNew: true },
  { name: "Kling 3.0", isNew: true },
  { name: "Kling 3.0 Turbo", isNew: true },
  { name: "Seedance 2.0 Fast", isNew: true },
  { name: "Exclusive Seedance 2.0 Mini", isNew: true },
  { name: "Seedance 2.0" },
  { name: "Cinefield DoP" },
  { name: "HappyHorse" },
  { name: "Kling 3.0 Omni" },
  { name: "Kling 2.5" },
  { name: "Kling 2.6" },
  { name: "Kling O1" },
  { name: "Grok" },
  { name: "Grok 1.5" },
  { name: "Google Veo 3.1" },
  { name: "Veo 3.1 Lite" },
  { name: "Google Veo 3" },
  { name: "Sora 2" },
  { name: "MiniMax H3", isNew: true },
  { name: "Minimax Hailuo" },
  { name: "Wan 2.5" },
  { name: "Wan 2.6" },
  { name: "Wan 2.7" },
  { name: "Wan 2.2" },
  { name: "Seedance Pro" },
  { name: "Seedance 1.5 Pro" },
  { name: "Cinefield" },
];

const CATEGORIES = [
  "All",
  "New",
  "Trending",
  "Effects",
  "Basic Camera Control",
  "Epic Camera Control",
  "Catch the Pulse",
  "Mix",
] as const;

type PresetCategory = (typeof CATEGORIES)[number];

interface VideoPreset {
  name: string;
  category?: Extract<
    PresetCategory,
    "Effects" | "Basic Camera Control" | "Epic Camera Control" | "Catch the Pulse"
  >;
  isNew?: boolean;
  trending?: boolean;
  topChoice?: boolean;
  /** Mixed cards join two preset names with "x" and carry a "Mixed" badge. */
  mixedWith?: string;
}

// Preset names come from the audit's recorded list; category / badge
// placement is placeholder data (the reference gates it behind a session).
const VIDEO_PRESETS: VideoPreset[] = [
  { name: "General", topChoice: true },
  { name: "Face Punch", category: "Effects", trending: true },
  { name: "Disintegration", category: "Effects" },
  { name: "Head Off", category: "Effects" },
  { name: "Turning Metal", category: "Effects", topChoice: true },
  { name: "Earth Zoom Out", category: "Epic Camera Control", trending: true },
  { name: "Duplicate", category: "Effects" },
  { name: "FPV Drone", category: "Epic Camera Control", topChoice: true },
  { name: "Handheld", category: "Basic Camera Control" },
  { name: "Mouth In", category: "Epic Camera Control" },
  { name: "Eyes In", category: "Epic Camera Control" },
  { name: "Black Tears", category: "Effects", isNew: true },
  { name: "Freezing", category: "Effects" },
  { name: "Head Explosion", category: "Effects" },
  { name: "Set On Fire", category: "Effects", trending: true },
  { name: "Thunder God", category: "Effects", isNew: true },
  { name: "3D Rotation", category: "Basic Camera Control" },
  { name: "Melting", category: "Effects" },
  { name: "Roll Transition", category: "Basic Camera Control" },
  { name: "Crash Zoom In", category: "Basic Camera Control", topChoice: true },
  { name: "Garden Bloom", category: "Catch the Pulse", isNew: true },
  { name: "Static", category: "Basic Camera Control" },
  { name: "Building Explosion", category: "Effects", trending: true },
  { name: "Clone Explosion", category: "Effects" },
  { name: "Dolly Zoom In", category: "Epic Camera Control", topChoice: true },
  { name: "Glowing Fish", category: "Catch the Pulse", isNew: true },
  { name: "Innerlight", category: "Catch the Pulse" },
  { name: "Snowboard Powder", category: "Catch the Pulse", trending: true },
  { name: "Arc Right", category: "Basic Camera Control" },
  { name: "Turning Metal", mixedWith: "Eyes In", category: "Effects" },
  { name: "Earth Zoom Out", mixedWith: "Set On Fire", category: "Effects" },
  { name: "Crash Zoom In", mixedWith: "Melting", category: "Effects" },
];

// Deterministic model coverage per preset — every preset belongs to the
// Cinefield preset family, plus a rotating slice of the other chips so each
// chip filters to a non-empty grid. Placeholder mapping (session-gated in
// the reference).
function modelsForPreset(index: number): string[] {
  const names = MODEL_CHIPS.map((chip) => chip.name);
  const extras = [0, 1, 2, 3].map(
    (k) => names[(index * 5 + k * 7) % names.length],
  );
  return Array.from(new Set(["Cinefield DoP", "Cinefield", ...extras]));
}

// Gradient placeholder tiles in the project's stand-in style — the
// reference's real preset video/photography is deliberately not downloaded.
const PRESET_TILE_GRADIENTS = [
  "linear-gradient(135deg, #3a2a22 0%, #23201d 45%, #101113 100%)",
  "linear-gradient(160deg, #2c2320 0%, #1b1d1f 55%, #0e0f11 100%)",
  "linear-gradient(120deg, #33261f 0%, #201e1c 50%, #121315 100%)",
  "linear-gradient(150deg, #271f1c 0%, #1d1a18 40%, #0f1012 100%)",
];

const INITIAL_VISIBLE = 18;
const LOAD_MORE_STEP = 12;

interface VideoPresetSelectorProps {
  /**
   * "change" replaces the current preset; "mix" is the reference's
   * for=second-motion mode — the same selector, choosing a SECOND preset
   * blended into the current one (strength 0.85).
   */
  mode: "change" | "mix";
  onClose: () => void;
  onSelectPreset?: (presetName: string) => void;
}

export default function VideoPresetSelector({
  mode,
  onClose,
  onSelectPreset,
}: VideoPresetSelectorProps) {
  const [search, setSearch] = useState("");
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [category, setCategory] = useState<PresetCategory>("All");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return VIDEO_PRESETS.map((preset, index) => ({ preset, index })).filter(
      ({ preset, index }) => {
        const displayName = preset.mixedWith
          ? `${preset.name} x ${preset.mixedWith}`
          : preset.name;
        if (query && !displayName.toLowerCase().includes(query)) return false;
        if (activeChip && !modelsForPreset(index).includes(activeChip))
          return false;
        if (category === "All") return true;
        if (category === "New") return Boolean(preset.isNew);
        if (category === "Trending") return Boolean(preset.trending);
        if (category === "Mix") return Boolean(preset.mixedWith);
        return preset.category === category;
      },
    );
  }, [search, activeChip, category]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const resetPaging = () => setVisibleCount(INITIAL_VISIBLE);

  return (
    <section
      aria-label={
        mode === "mix" ? "Choose a second motion to mix" : "Choose a preset"
      }
      className="flex h-full min-h-0 flex-col gap-2.5"
    >
      {/* Horizontal model chip strip — chips filter the preset grid. */}
      <div className="hide-scrollbar flex shrink-0 gap-1.5 overflow-x-auto">
        {MODEL_CHIPS.map((chip) => {
          const selected = activeChip === chip.name;
          return (
            <button
              key={chip.name}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setActiveChip(selected ? null : chip.name);
                resetPaging();
              }}
              className={`flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                selected
                  ? "border-[#D97757]/60 bg-[#D97757]/15 text-white"
                  : "border-white/[0.07] bg-white/[0.035] text-zinc-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {chip.name}
              {chip.isNew && (
                <span className="text-[9px] font-bold text-[#ef9a7e]">NEW</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search box + square X close button. */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3">
          <Search className="size-4 shrink-0 text-zinc-500" />
          <input
            name="video-preset-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPaging();
            }}
            placeholder="Search"
            aria-label="Search presets"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </div>
        <button
          type="button"
          aria-label="Close preset selector"
          onClick={onClose}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Category pills. */}
      <div className="hide-scrollbar flex shrink-0 gap-1.5 overflow-x-auto">
        {CATEGORIES.map((item) => {
          const selected = category === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setCategory(item);
                resetPaging();
              }}
              className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition-colors ${
                selected
                  ? "bg-[#D97757] text-black"
                  : "bg-white/[0.05] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {item}
            </button>
          );
        })}
      </div>

      {/* Preset grid + Load more. */}
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto pb-3">
        {visible.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <p className="text-sm text-zinc-500">No presets found</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {visible.map(({ preset, index }) => {
              const displayName = preset.mixedWith
                ? `${preset.name} x ${preset.mixedWith}`
                : preset.name;
              return (
                <button
                  key={`${displayName}-${index}`}
                  type="button"
                  onClick={() => {
                    onSelectPreset?.(displayName);
                    onClose();
                  }}
                  className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-white/[0.06] text-left transition-colors hover:border-[#D97757]/55"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{
                      background:
                        PRESET_TILE_GRADIENTS[
                          index % PRESET_TILE_GRADIENTS.length
                        ],
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)",
                    }}
                  />
                  {preset.topChoice && (
                    <span className="absolute left-1.5 top-1.5 z-10 rounded-md bg-[#D97757] px-1.5 py-0.5 text-[10px] font-bold text-black">
                      Top Choice
                    </span>
                  )}
                  {preset.mixedWith && (
                    <span className="absolute left-1.5 top-1.5 z-10 rounded-md border border-white/15 bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      Mixed
                    </span>
                  )}
                  <h4
                    className={`absolute bottom-2 left-2 right-2 z-10 truncate text-xs font-black text-white ${
                      preset.mixedWith ? "" : "uppercase"
                    }`}
                  >
                    {displayName}
                  </h4>
                </button>
              );
            })}
          </div>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + LOAD_MORE_STEP)}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Load more
          </button>
        )}
      </div>
    </section>
  );
}

"use client";

import { motion } from "framer-motion";
import { AudioLines, Download, Heart, Loader2, Play } from "lucide-react";
import type { AudioLayout, AudioTab } from "./AudioTopControls";

export interface AudioClip {
  id: string;
  label: string;
  liked?: boolean;
}

interface AudioFeedProps {
  clips: AudioClip[];
  isGenerating: boolean;
  activeTab: AudioTab;
  layout: AudioLayout;
  density: number;
  onToggleLike: (id: string) => void;
}

const GRADIENT_TEXT =
  "linear-gradient(90deg, rgb(224,123,175) 0%, rgb(212,160,122) 40%, rgb(200,179,110) 60%, rgb(212,160,122) 80%, rgb(224,164,192) 100%)";

const WAVE_BARS = Array.from({ length: 40 }, (_, i) =>
  28 + Math.round(Math.abs(Math.sin(i * 0.55)) * 60),
);

/** Decorative corner guide ticks around the heading (matches reference). */
function CornerGuides() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <span className="absolute left-0 top-0 h-px w-4 -translate-x-[22px] bg-white/20" />
      <span className="absolute left-0 top-0 h-4 w-px -translate-y-[22px] bg-white/20" />
      <span className="absolute right-0 top-0 h-px w-4 translate-x-[22px] bg-white/20" />
      <span className="absolute right-0 top-0 h-4 w-px -translate-y-[22px] bg-white/20" />
      <span className="absolute bottom-0 left-0 ml-4 h-px w-4 -translate-x-[22px] bg-white/20" />
      <span className="absolute bottom-0 left-0 ml-4 h-4 w-px translate-y-[22px] bg-white/20" />
      <span className="absolute bottom-0 right-0 mr-4 h-px w-4 translate-x-[22px] bg-white/20" />
      <span className="absolute bottom-0 right-0 mr-4 h-4 w-px translate-y-[22px] bg-white/20" />
    </div>
  );
}

function EmptyState({ liked }: { liked: boolean }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-6 pb-[200px]"
      data-ignore-marquee="true"
    >
      <div className="relative flex flex-col items-center">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Audio
        </p>
        <div className="relative">
          {/* Soft blurred colorful glow behind heading */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 rounded-full mix-blend-lighten"
            style={{
              width: "160%",
              height: "220%",
              transform: "translate(-20%, -30%) rotate(176deg)",
              background:
                "linear-gradient(270deg, rgba(235,67,143,0.29) 31%, rgba(218,159,49,0.29) 54%, rgba(201,138,227,0.29) 76%, rgba(13,38,76,0.29) 99%)",
              filter: "blur(100px)",
            }}
          />
          <div className="relative flex flex-col items-center text-center text-3xl font-semibold md:text-4xl">
            {liked ? (
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: GRADIENT_TEXT }}
              >
                No liked audio yet
              </span>
            ) : (
              <>
                <span
                  className="bg-clip-text px-4 text-transparent"
                  style={{ backgroundImage: GRADIENT_TEXT }}
                >
                  Ready to give your
                </span>
                <span
                  className="bg-clip-text px-4 text-transparent"
                  style={{ backgroundImage: GRADIENT_TEXT }}
                >
                  scene a voice?
                </span>
              </>
            )}
          </div>
          <CornerGuides />
        </div>
      </div>
    </div>
  );
}

function ClipRow({
  clip,
  onToggleLike,
}: {
  clip: AudioClip;
  onToggleLike: (id: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
    >
      <button
        type="button"
        aria-label="Play clip"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-magenta-500/15 text-magenta-400 transition-colors hover:bg-magenta-500/25"
      >
        <Play className="h-3.5 w-3.5" fill="currentColor" />
      </button>
      <div className="flex h-6 flex-1 items-center gap-[2px] overflow-hidden">
        {WAVE_BARS.map((h, i) => (
          <span
            key={i}
            className="w-[2px] rounded-full bg-white/20"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="max-w-[140px] truncate text-xs text-zinc-400">
        {clip.label}
      </span>
      <button
        type="button"
        onClick={() => onToggleLike(clip.id)}
        aria-label="Like"
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
          clip.liked
            ? "text-magenta-400"
            : "text-zinc-400 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Heart className="h-3.5 w-3.5" fill={clip.liked ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        aria-label="Download"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-magenta-500/15 hover:text-magenta-400"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

function ClipCard({
  clip,
  onToggleLike,
}: {
  clip: AudioClip;
  onToggleLike: (id: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="group flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Play clip"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-magenta-500/15 text-magenta-400 transition-colors hover:bg-magenta-500/25"
        >
          <Play className="h-4 w-4" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={() => onToggleLike(clip.id)}
          aria-label="Like"
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            clip.liked
              ? "text-magenta-400"
              : "text-zinc-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Heart className="h-4 w-4" fill={clip.liked ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="flex h-12 items-center gap-[2px] overflow-hidden">
        {WAVE_BARS.map((h, i) => (
          <span
            key={i}
            className="w-[2px] rounded-full bg-white/20"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="truncate text-xs text-zinc-400">{clip.label}</span>
    </motion.div>
  );
}

export default function AudioFeed({
  clips,
  isGenerating,
  activeTab,
  layout,
  density,
  onToggleLike,
}: AudioFeedProps) {
  const visible = activeTab === "liked" ? clips.filter((c) => c.liked) : clips;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="h-full overflow-y-auto px-6 pb-[176px] pt-20">
        {visible.length === 0 && !isGenerating ? (
          <EmptyState liked={activeTab === "liked"} />
        ) : (
          <div className="mx-auto w-full max-w-4xl">
            {isGenerating && (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin text-magenta-400" />
                Synthesizing voice…
              </div>
            )}
            {visible.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/[0.07] bg-white/[0.015] px-3 py-3 text-sm text-zinc-500">
                <AudioLines className="h-4 w-4 text-white/15" />
                Generating your first clip…
              </div>
            ) : layout === "grid" ? (
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${density}, minmax(0, 1fr))`,
                }}
              >
                {visible.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} onToggleLike={onToggleLike} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map((clip) => (
                  <ClipRow key={clip.id} clip={clip} onToggleLike={onToggleLike} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom audio wave visual (behind/above the composer) — matches the
          reference: one image, full width, native 246px height, 30% opacity. */}
      <div className="pointer-events-none absolute bottom-0 h-[246px] w-full">
        <figure className="group relative h-full w-full opacity-30">
          <img
            src="/assets/higgsfield/audio/waves.svg"
            alt="audio waves"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </figure>
      </div>
    </div>
  );
}

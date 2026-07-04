"use client";

import { motion } from "framer-motion";
import { Film, Loader2, Play } from "lucide-react";

export interface VideoShot {
  id: string;
  label: string;
  gradient: string;
}

interface VideoPreviewCanvasProps {
  isGenerating: boolean;
  shots: VideoShot[];
}

export default function VideoPreviewCanvas({ isGenerating, shots }: VideoPreviewCanvasProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Large preview canvas */}
      <div className="relative mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,229,255,0.1),transparent_45%,transparent_60%,rgba(0,229,255,0.08))]" />

        {isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-magenta-400" />
            <p className="text-sm text-zinc-400">Rendering your shot…</p>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              aria-label="Play preview"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform hover:scale-110"
            >
              <Play className="h-6 w-6 text-white" fill="white" />
            </button>
          </div>
        )}

        <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md">
          1080p · 24fps · Preview
        </div>
      </div>

      {/* Recent shots strip */}
      <div className="mx-auto mt-6 w-full max-w-4xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Recent Shots
        </h2>
        {shots.length === 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                className="flex aspect-video w-40 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/[0.07] bg-white/[0.015]"
              >
                <Film className="h-4 w-4 text-white/15" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {shots.map((shot) => (
              <motion.div
                key={shot.id}
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                className="group relative aspect-video w-44 shrink-0 overflow-hidden rounded-xl border border-white/[0.07]"
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${shot.gradient} transition-transform duration-500 group-hover:scale-110`}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="h-5 w-5 text-white/30" fill="currentColor" />
                </div>
                <div className="absolute bottom-1.5 left-1.5 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-200 backdrop-blur-md">
                  {shot.label}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

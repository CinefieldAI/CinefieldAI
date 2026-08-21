"use client";

import Navbar from "@/components/landing/Navbar";
import AiVideoPromptBar from "@/components/ai-video/AiVideoPromptBar";
import { spaceGrotesk } from "@/lib/fonts/spaceGrotesk";

// Structure/sizing cloned from the reference site's own /ai-video hero (full
// -bleed background video, centered title/subtitle/CTA, prompt bar overlaid
// near the bottom) — the background media area is left empty (no src) rather
// than hotlinking the reference's own video, per the standing no-scraped-
// media rule. Shares the site's normal Navbar unmodified, same as every
// other standalone page.
export default function AiVideoPage() {
  const noop = () => {};

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <Navbar
        activePanel={null}
        onOpenImagePanel={noop}
        onOpenVideoPanel={noop}
        onOpenAudioPanel={noop}
        onSetView={noop}
      />

      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center overflow-hidden px-4 pb-10 pt-16 md:pt-24">
        <div className="absolute inset-4 overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.08] to-white/[0.02]">
          <video
            loop
            playsInline
            disablePictureInPicture
            preload="metadata"
            autoPlay
            muted
            className="size-full w-full h-full rounded-2xl object-cover"
          >
            Your browser does not support the video.
          </video>
          <div className="absolute inset-0 bg-black/45" />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-6 text-center">
          <h1
            className={`${spaceGrotesk.className} max-w-4xl text-4xl uppercase leading-tight md:text-6xl`}
          >
            AI Video Generator.
            <br />
            Studio-grade results.
          </h1>
          <p className="max-w-xl text-sm text-white/80 md:text-base">
            From prompt to cinematic video in seconds. Every top model, one workspace. Bring impossible shots to
            life.
          </p>
          <button
            type="button"
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Create Video Now
          </button>
        </div>

        <div className="relative z-10 mt-auto w-full px-4 pt-16">
          <AiVideoPromptBar />
        </div>
      </main>
    </div>
  );
}

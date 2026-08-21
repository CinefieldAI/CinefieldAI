"use client";

import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import Navbar from "@/components/landing/Navbar";
import AiVideoPromptBar from "@/components/ai-video/AiVideoPromptBar";
import { spaceGrotesk } from "@/lib/fonts/spaceGrotesk";

/**
 * Background clip for the hero. Drop a file Cinefield owns at this path and
 * it plays automatically; until one exists the poster gradient shows through
 * and the sound button simply has nothing to unmute.
 */
const HERO_VIDEO_SRC = "/ai-video/hero.mp4";

// Structure/sizing cloned from the reference site's own /ai-video hero (full
// -bleed background video, centered title/subtitle/CTA, prompt bar overlaid
// near the bottom). Shares the site's normal Navbar unmodified, same as every
// other standalone page.
export default function AiVideoPage() {
  const noop = () => {};
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  // Autoplay only survives muted, so the hero starts silent and the button
  // is the only way to bring sound in — same contract as /generate.
  const [isHeroVideoMuted, setIsHeroVideoMuted] = useState(true);

  const toggleHeroVideoMute = () => {
    if (heroVideoRef.current) {
      heroVideoRef.current.muted = !heroVideoRef.current.muted;
      setIsHeroVideoMuted(heroVideoRef.current.muted);
    }
  };

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
            ref={heroVideoRef}
            src={HERO_VIDEO_SRC}
            loop
            playsInline
            disablePictureInPicture
            preload="metadata"
            autoPlay
            muted={isHeroVideoMuted}
            className="size-full w-full h-full rounded-2xl object-cover"
          >
            Your browser does not support the video.
          </video>
          <div className="absolute inset-0 bg-black/45" />
        </div>

        <button
          type="button"
          onClick={toggleHeroVideoMute}
          aria-label={isHeroVideoMuted ? "Unmute video" : "Mute video"}
          className="absolute right-10 top-10 z-40 flex size-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-lg backdrop-blur-md transition-all hover:bg-black/80 hover:text-white active:scale-95"
        >
          {isHeroVideoMuted ? (
            <VolumeX className="size-4 text-white/70" />
          ) : (
            <Volume2 className="size-4 text-white" />
          )}
        </button>

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

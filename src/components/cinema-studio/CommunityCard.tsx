"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Eye, Heart, Volume2, VolumeX } from "lucide-react";

export interface CommunityItem {
  id: string;
  title: string;
  creator: string;
  creatorAvatar: string;
  /** Still shown at rest (and as the video's poster). */
  poster: string;
  /** Optional clip that fades in on hover. */
  hoverVideo?: string;
  views: string;
  likes: string;
  href: string;
  /** Shows the small "Team" pill next to the creator name. */
  team?: boolean;
}

/**
 * Higgsfield-style community card — dark secondary surface, rounded media
 * well with an aspect-video preview that cross-fades to a muted clip on
 * hover, then a compact title row and creator/stats row underneath.
 */
export default function CommunityCard({ item }: { item: CommunityItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [muted, setMuted] = useState(true);

  const handleEnter = () => {
    setHovered(true);
    // Only the hovered card's clip plays — never all nine at once.
    void videoRef.current?.play().catch(() => {});
  };

  const handleLeave = () => {
    setHovered(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  };

  return (
    <a
      href={item.href}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="group flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-2 transition-colors duration-200 hover:bg-white/[0.08]"
    >
      {/* Media well — video only, no static poster image */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        {item.hoverVideo && (
          <>
            <video
              ref={videoRef}
              muted={muted}
              loop
              playsInline
              autoPlay
              preload="auto"
              className="absolute inset-0 h-full w-full object-cover"
            >
              <source src={item.hoverVideo} type="video/mp4" />
            </video>

            {/* Unmute toggle — lower-right of the media, hover only */}
            <button
              type="button"
              aria-label={muted ? "Unmute preview" : "Mute preview"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMuted((m) => !m);
              }}
              className={`absolute bottom-2 right-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
                hovered ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
          </>
        )}
      </div>

      {/* Title */}
      <p className="truncate px-1 text-xs font-medium text-white/90 transition-colors duration-200 group-hover:text-white">
        {item.title}
      </p>

      {/* Creator + stats */}
      <div className="flex items-center gap-2 px-1 pb-0.5">
        <Image
          src={item.creatorAvatar}
          alt=""
          width={20}
          height={20}
          className="size-5 shrink-0 rounded-full object-cover"
        />
        <span className="truncate text-[11px] text-white/50 transition-colors duration-200 group-hover:text-white/70">
          {item.creator}
        </span>
        {item.team && (
          <span className="shrink-0 rounded bg-white/10 px-1 py-px text-[9px] font-semibold uppercase leading-none text-white/60">
            Team
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2.5 text-[11px] text-white/50">
          <span className="flex items-center gap-1">
            <Eye className="size-3" />
            {item.views}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="size-3" />
            {item.likes}
          </span>
        </span>
      </div>
    </a>
  );
}

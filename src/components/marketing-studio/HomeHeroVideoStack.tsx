"use client";

import { useState, useEffect } from "react";
import { LOCAL_MARKETING_VIDEOS } from "@/data/localMarketingVideos";

interface VideoCard {
  src: string;
  baseWidth: number;
  baseHeight: number;
  openTransform: string;
  closedTransform: string;
  zIndex: number;
  isCenter?: boolean;
}

export default function HomeHeroVideoStack() {
  const [isOpen, setIsOpen] = useState(true);

  // Alternate between open/closed state every 4 seconds
  const animatingTransform = (video: VideoCard) => {
    return isOpen ? video.openTransform : video.closedTransform;
  };

  const videos: VideoCard[] = [
    {
      src: LOCAL_MARKETING_VIDEOS[0],
      baseWidth: 178,
      baseHeight: 267,
      openTransform: "translateX(80px) translateY(24px) rotate(-8deg)",
      closedTransform: "translateX(147px) translateY(17px) rotate(0deg)",
      zIndex: 1,
    },
    {
      src: LOCAL_MARKETING_VIDEOS[1],
      baseWidth: 200,
      baseHeight: 300,
      openTransform: "translateX(136px) translateY(1px)",
      closedTransform: "translateX(136px) translateY(1px)",
      zIndex: 3,
      isCenter: true,
    },
    {
      src: LOCAL_MARKETING_VIDEOS[2],
      baseWidth: 178,
      baseHeight: 267,
      openTransform: "translateX(214px) translateY(24px) rotate(8deg)",
      closedTransform: "translateX(147px) translateY(17px) rotate(0deg)",
      zIndex: 2,
    },
  ];

  // Start animation loop
  useEffect(() => {
    const interval = setInterval(() => {
      setIsOpen((prev) => !prev);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full">
      {/* Video Stack */}
      <div className="relative mb-8 h-[309px] w-[472px]" style={{ perspective: "1000px" }}>
        {videos.map((video) => (
          <div
            key={video.src}
            className={`absolute rounded-2xl overflow-hidden ${
              video.isCenter ? "border-2 border-white/[0.22]" : "border border-white/[0.18]"
            } bg-black/30 backdrop-blur-sm transition-transform duration-700 ease-in-out`}
            style={{
              width: `${video.baseWidth}px`,
              height: `${video.baseHeight}px`,
              transform: animatingTransform(video),
              zIndex: video.zIndex,
            }}
          >
            <video
              src={video.src}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>

      {/* Headline */}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.24px] text-white">
          Turn a prompt into a marketing video
        </h1>
        <p className="text-sm font-medium leading-5 text-white/60 max-w-[520px]">
          Describe what happens in the ad, all single-prompt ad videos will show up right here.
        </p>
      </div>
    </div>
  );
}

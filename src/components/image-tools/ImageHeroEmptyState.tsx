"use client";

import Image from "next/image";

const MODEL_NAMES: Record<string, string> = {
  "nano-banana-pro": "Nano Banana Pro",
  "seedream-5-lite": "Seedream 5.0 Lite",
  "flux-2-pro": "FLUX.2 Pro",
  "gpt-image": "GPT Image",
  "recraft-v4-1": "Recraft V4.1",
};

const HIGGSFIELD_IMAGES = [
  "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-01.jpg",
  "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-02.jpg",
  "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-03.jpg",
  "https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-04.jpg",
];

interface ImageHeroEmptyStateProps {
  selectedModel: string;
}

function ImageCard({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900 ${className}`} style={style}>
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        unoptimized
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

export default function ImageHeroEmptyState({
  selectedModel,
}: ImageHeroEmptyStateProps) {
  const modelName = MODEL_NAMES[selectedModel] || "Create Image";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      {/* Image collage stack */}
      <div className="relative w-full flex items-center justify-center">
        {/* Blurred background stack */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2 blur-[32px] opacity-40 flex items-center">
          <ImageCard src={HIGGSFIELD_IMAGES[0]} alt="BG1" className="size-28 rounded-3xl" />
          <ImageCard src={HIGGSFIELD_IMAGES[1]} alt="BG2" className="size-28 rounded-3xl -ml-8" />
          <ImageCard src={HIGGSFIELD_IMAGES[2]} alt="BG3" className="size-28 rounded-full -ml-8" />
          <ImageCard src={HIGGSFIELD_IMAGES[3]} alt="BG4" className="size-28 rounded-3xl -ml-8" />
        </div>

        {/* Sharp front stack */}
        <div className="relative flex items-center isolate">
          <ImageCard
            src={HIGGSFIELD_IMAGES[0]}
            alt="Gallery 1"
            className="size-32 rounded-2xl border-4 border-white/30 shadow-lg z-40"
            style={{ transform: "rotate(-12deg)" }}
          />
          <ImageCard
            src={HIGGSFIELD_IMAGES[1]}
            alt="Gallery 2"
            className="size-32 rounded-2xl shadow-lg -ml-12 z-30"
            style={{ transform: "rotate(6deg)" }}
          />
          <ImageCard
            src={HIGGSFIELD_IMAGES[2]}
            alt="Gallery 3"
            className="size-32 rounded-full border-4 border-white/30 shadow-lg -ml-12 z-20"
            style={{ transform: "rotate(180deg) scaleY(-1)" }}
          />
          <ImageCard
            src={HIGGSFIELD_IMAGES[3]}
            alt="Gallery 4"
            className="size-32 rounded-2xl border-4 border-white/30 shadow-lg -ml-12 z-10"
            style={{ transform: "rotate(-6deg)" }}
          />
        </div>
      </div>

      {/* Hero text */}
      <div className="flex flex-col gap-4 items-center text-center max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight leading-tight uppercase">
          <span className="text-white">Start creating with</span>{" "}
          <span className="text-[#E61E8F]">{modelName}</span>
        </h1>

        <p className="text-base text-zinc-400">
          Describe a scene, character, mood, or style — and watch it come to
          life
        </p>
      </div>
    </div>
  );
}

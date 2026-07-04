"use client";

import { IMAGE_MODEL_CONFIGS } from "@/lib/imageModelConfig";

interface HeroSectionProps {
  selectedModel: string;
}

export default function HeroSection({ selectedModel }: HeroSectionProps) {
  const config = IMAGE_MODEL_CONFIGS[selectedModel];
  const modelLabel = config?.label || "Nano Banana Pro";

  return (
    <div className="flex-1 flex flex-col items-center justify-center pt-20 pb-32">
      {/* Hero image collage */}
      <div className="relative flex justify-center mb-6">
        {/* Glow backdrop */}
        <div className="absolute inset-0 -z-10 blur-3xl opacity-40 bg-blue-500/20 rounded-full scale-125" />

        {/* Collage */}
        <div className="flex items-center isolate">
          {/* Card 1 */}
          <div
            className="flex items-center justify-center shrink-0 -mr-[clamp(16px,min(1.5vw,2vh),36px)]"
            style={{ zIndex: 4 }}
          >
            <div className="flex-none -rotate-[10deg]">
              <div className="relative overflow-hidden size-[clamp(64px,min(12vw,16vh),172px)] rounded-xl border-[3px] xl:border-4 border-white/30 shadow-lg">
                <img
                  src="https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-01.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div
            className="flex items-center justify-center shrink-0 -mr-[clamp(16px,min(1.5vw,2vh),36px)]"
            style={{ zIndex: 3 }}
          >
            <div className="flex-none rotate-[4deg]">
              <div className="relative overflow-hidden size-[clamp(64px,min(12vw,16vh),172px)] rounded-xl shadow-lg">
                <img
                  src="https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-02.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Card 3 - Circular */}
          <div
            className="flex items-center justify-center shrink-0 -mr-[clamp(16px,min(1.5vw,2vh),36px)]"
            style={{ zIndex: 2 }}
          >
            <div className="flex-none rotate-180 -scale-y-100">
              <div className="relative overflow-hidden size-[clamp(64px,min(12vw,16vh),172px)] rounded-full border-[3px] xl:border-4 border-white/30 shadow-lg">
                <img
                  src="https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-03.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Card 4 */}
          <div
            className="flex items-center justify-center shrink-0"
            style={{ zIndex: 1 }}
          >
            <div className="flex-none -rotate-[4deg]">
              <div className="relative overflow-hidden size-[clamp(64px,min(12vw,16vh),172px)] rounded-xl border-[3px] xl:border-4 border-white/30 shadow-lg">
                <img
                  src="https://higgsfield.ai/cdn-cgi/image/fit=scale-down,format=webp,onerror=redirect,width=1920,quality=85/image/empty-state/image-04.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Headline */}
      <div className="text-center mb-4">
        <h1 className="text-5xl font-black tracking-tight mb-1">
          <span className="text-white">START CREATING WITH</span>
        </h1>
        <h2 className="text-5xl font-black text-[#CCFF00] tracking-tight">
          {modelLabel.toUpperCase()}
        </h2>
      </div>

      {/* Subtitle */}
      <p className="text-center text-zinc-500 text-base max-w-md leading-relaxed">
        Describe a scene, character, mood, or style — and watch it come to life
      </p>
    </div>
  );
}

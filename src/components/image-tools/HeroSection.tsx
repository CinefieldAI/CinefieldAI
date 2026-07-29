"use client";

import { IMAGE_MODEL_CONFIGS } from "@/lib/imageModelConfig";

interface HeroSectionProps {
  selectedModel: string;
}

export default function HeroSection({ selectedModel }: HeroSectionProps) {
  const config = IMAGE_MODEL_CONFIGS[selectedModel];
  const modelLabel = config?.label || "Nano Banana Pro";

  return (
    // Padding kept tight (vs. a standalone hero) — this is embedded inline
    // above the Cinema Studio composer, whose vertical position must match
    // the Video-mode hero (HeroBanner) so switching Image/Video doesn't
    // shift the prompt bar/mode toggle up and down.
    <div className="flex-1 flex flex-col items-center justify-center pt-0 pb-2">
      {/* Hero image collage */}
      <div className="relative flex justify-center mb-2">
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
                  src="/2tmMPworfGRQQV2jUQTs--PTRuxXbt15FmGGDkpRIxyeY0BKlHMXIc8QJ6sQJoCRzgyYo-PHkTOzcMO8kXsiIKn36ste2_FDqhzuMKIxrObcgygk9fp-5FWvDtCrwm104OSiqme8iWrSJNWmi7psivSq9U_S5s8LhZLDuHeRQokmUunVruTEIPzjAzRNKjs3.jpg"
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
                  src="/JUU36OQ7k76nKTiwQh9fa49_GrMWqPew68Ruy_kmeX0n7lCHU9hr5Lpawl6ScsFzRZbDguHa0W0dC8Ew0VVCXaaneJxcXSDgxBkxalWhPLQw5fioQHkYbClrRA2F8e23g7hu6R8Wb7OaZqro6jpfEd7qtok7u840oy0OMSDSc-GwE4oHv870h0JCzahF-18h.jpg"
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
                  src="/ewvdQLNUkUStuLzM0TqzY7MhUMSgXxVgHgr2pSugeXSmloRcwjFcEicd80JN5wHnwQ31yIUZsIrMdg8riK_CSuPUCdpXiztTWNvZUjrZqMbzpl6ggs_ThUv1sMRTzBTdioZGsMfW1eSJk2pfjktjNWnUtGK_pRlKo3rxYqQtBbhdH126zFEmAutlGKmnY9lF.jpg"
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
                  src="/S_IInroxd9V7zx_PkQXe3MqHwurUDjtwLvdYyJOXd2QMaBNGPGwXVVQnzRTOf9T80Bvhpn9UbzmfavJnYz2a_IItPobr5cmp3PNRGwqJKz9HZSePKrBo7ImQrp4Dr3539NTwvbPjFYhurYvfroNk7Q96SUh2D606iDQDlCDaMq1MdbpoB0TMISY8puRCbx5y.jpg"
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Headline */}
      <div className="text-center mb-1">
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

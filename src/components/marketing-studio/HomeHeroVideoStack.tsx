"use client";

interface VideoCard {
  src: string;
  poster: string;
  width: number;
  height: number;
  transform: string;
  zIndex: number;
  isCenter?: boolean;
}

export default function HomeHeroVideoStack() {
  const videos: VideoCard[] = [
    {
      src: "https://d8j0ntlcm91z4.cloudfront.net/user_3Cfdr00kbZ1hJCLpPQkaicInqxv/hf_20260603_150008_ee9cf142-7741-40e9-8076-897fb0947742.mp4",
      poster: "https://cdn.higgsfield.ai/user_3Cfdr00kbZ1hJCLpPQkaicInqxv/hf_20260603_150008_ee9cf142-7741-40e9-8076-897fb0947742_thumbnail.webp",
      width: 178,
      height: 267,
      transform: "translateX(80px) translateY(24px) rotate(-8deg)",
      zIndex: 1,
    },
    {
      src: "https://static.higgsfield.ai/marketing-studio-presets/ugc.mp4",
      poster: "https://static.higgsfield.ai/marketing-studio-presets/ugc-thumbnail.webp",
      width: 200,
      height: 300,
      transform: "translateX(136px) translateY(1px)",
      zIndex: 3,
      isCenter: true,
    },
    {
      src: "https://static.higgsfield.ai/ms-modes/ugc_gadget_saved_me.mp4",
      poster: "https://static.higgsfield.ai/ms-modes/ugc_gadget_saved_me.jpg",
      width: 178,
      height: 267,
      transform: "translateX(214px) translateY(24px) rotate(8deg)",
      zIndex: 2,
    },
  ];

  return (
    <section className="flex flex-col items-center justify-center min-h-screen px-8 py-20">
      {/* Headline */}
      <div className="text-center mb-20 max-w-2xl">
        <h1 className="text-5xl font-extrabold text-white mb-4">
          Turn a prompt into a marketing video
        </h1>
        <p className="text-white/60 text-base">
          Describe what happens in the ad, all single-prompt ad videos will show up right here.
        </p>
      </div>

      {/* Video Stack */}
      <div className="relative h-[309px] w-[472px]" style={{ perspective: "1000px" }}>
        {videos.map((video) => (
          <div
            key={video.src}
            className={`absolute rounded-2xl overflow-hidden ${
              video.isCenter ? "border-2 border-white/[0.22]" : "border border-white/[0.18]"
            } bg-black/30 backdrop-blur-sm`}
            style={{
              width: `${video.width}px`,
              height: `${video.height}px`,
              transform: video.transform,
              zIndex: video.zIndex,
            }}
          >
            <video
              src={video.src}
              poster={video.poster}
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
    </section>
  );
}

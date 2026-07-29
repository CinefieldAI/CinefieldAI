const TUTORIAL_STEPS = [
  {
    number: "01",
    title: "ADD IMAGE",
    description: "Upload or generate an image to start your animation",
    type: "image" as const,
    src: "https://static.higgsfield.ai/feed/step-1-v2.webp",
  },
  {
    number: "02",
    title: "CHOOSE PRESET",
    description: "Pick a preset to control your image movement",
    type: "video" as const,
    src: "https://static.higgsfield.ai/feed/step-2.mp4",
    poster: "https://static.higgsfield.ai/feed/step2-thumbnail.webp",
  },
  {
    number: "03",
    title: "GET VIDEO",
    description: "Click generate to create your final animated video!",
    type: "video" as const,
    src: "https://static.higgsfield.ai/feed/step-3.mp4",
    poster: "https://static.higgsfield.ai/feed/step-3-thumbnail.webp",
  },
];

export default function StandaloneVideoHowItWorks() {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#181a1c] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="mb-8 max-w-3xl">
        <p className="mb-3 text-xs font-semibold uppercase text-[#D97757]">
          Video workflow
        </p>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">
          MAKE VIDEOS IN ONE CLICK
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400 sm:text-base">
          250+ presets for camera control, framing, and high-quality VFX - or
          use the general preset for manual control.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-7 md:grid-cols-2 xl:grid-cols-3">
        {TUTORIAL_STEPS.map((step) => (
          <article key={step.title} className="min-w-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#101112]">
              {step.type === "image" ? (
                <img
                  src={step.src}
                  alt="Add an image to start a video"
                  className="size-full object-cover"
                />
              ) : (
                <video
                  className="size-full object-cover"
                  src={step.src}
                  poster={step.poster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={step.title}
                />
              )}
              <span className="absolute left-3 top-3 rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] text-white backdrop-blur-sm">
                {step.number}
              </span>
            </div>
            <h2 className="mt-4 text-sm font-bold text-white">{step.title}</h2>
            <p className="mt-1.5 text-sm leading-5 text-zinc-500">
              {step.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

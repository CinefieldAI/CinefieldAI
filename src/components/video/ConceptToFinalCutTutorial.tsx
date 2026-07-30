const STEPS = [
  {
    badge: "Step 1",
    title: "INPUT ANYTHING",
    description:
      "Upload reference images (up to 7), a video clip, or simply start with a text idea.",
    src: "/asset/empty/video-edit/step-1.webp",
  },
  {
    badge: "Step 2",
    title: "WRITE THE PROMPT",
    description:
      "Use natural language to direct the scene and describe desired scenario",
    src: "/asset/empty/video-edit/step-2.webp",
  },
  {
    badge: "Step 3",
    title: "GENERATE WITH KLING",
    description:
      "Receive high-fidelity video in seconds. Iterate and edit the result seamlessly to perfect your shot",
    src: "/asset/empty/video-edit/step-3.webp",
  },
];

export default function ConceptToFinalCutTutorial() {
  return (
    <section className="flex w-full self-start flex-col rounded-[1.25rem] border border-white/[0.07] bg-[#181a1c] px-5 py-14 sm:px-8 sm:py-20 lg:py-24">
      <header className="mb-8 flex w-full items-center justify-center">
        <h1 className="text-center text-2xl font-bold uppercase text-white sm:text-3xl">
          FROM CONCEPT TO FINAL CUT IN SECONDS
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((step) => (
          <article key={step.title} className="flex min-w-0 flex-col items-center">
            <figure className="relative mx-auto mb-4 aspect-[328/331] max-h-[331px] w-full max-w-[328px] overflow-hidden rounded-2xl bg-[#101112]">
              <img
                src={step.src}
                alt=""
                className="size-full object-cover"
                width={328}
                height={331}
              />
            </figure>
            <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-zinc-300">
              {step.badge}
            </span>
            <h2 className="mt-2 text-center text-base font-bold uppercase text-white">
              {step.title}
            </h2>
            <p className="mt-2 max-w-sm text-center text-sm leading-5 text-zinc-500">
              {step.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

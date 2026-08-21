export default function SupercomputerBannerSection() {
  return (
    <div className="w-full pt-8 pb-4">
      <section
        className="relative mx-auto w-full overflow-hidden rounded-[24px] border border-[#d1fe17]/30 bg-[#061104] min-h-[340px] md:min-h-[420px] flex items-center justify-center p-6 md:p-12"
        style={{
          boxShadow:
            "0 0 50px rgba(209, 254, 23, 0.15), inset 0 0 120px rgba(209, 254, 23, 0.12), inset 0 0 30px rgba(209, 254, 23, 0.2)",
        }}
      >
        {/* Background Grid Pattern & Radial Neon Glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(209,254,23,0.2)_0%,rgba(6,17,4,0.8)_60%,rgba(6,17,4,1)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(209, 254, 23, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(209, 254, 23, 0.15) 1px, transparent 1px)",
            backgroundSize: "3rem 3rem",
          }}
        />

        {/* Decorative Floating Cards (Left) */}
        <div className="hidden lg:block absolute left-8 top-1/2 -translate-y-1/2 z-10 w-[240px] rounded-2xl bg-black/60 border border-[#d1fe17]/20 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs font-semibold text-white/90">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#d1fe17]" />
              UGC Creator
            </span>
            <span className="text-[10px] text-white/40">2/2</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <div className="aspect-[3/4] rounded-lg bg-white/10 overflow-hidden border border-white/10" />
            <div className="aspect-[3/4] rounded-lg bg-white/10 overflow-hidden border border-white/10" />
            <div className="aspect-[3/4] rounded-lg bg-white/10 overflow-hidden border border-white/10" />
          </div>
          <div className="mt-2.5 flex items-center justify-center">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-[#d1fe17] border border-[#d1fe17]/30">
              UGC ✓
            </span>
          </div>
        </div>

        {/* Decorative Floating Badges (Right Top) */}
        <div className="hidden lg:flex absolute right-40 top-12 z-10 items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-black shadow-lg">
          <span>Visualizing</span>
        </div>

        {/* Decorative Floating Cards (Right Side) */}
        <div className="hidden lg:block absolute right-8 top-1/3 z-10 w-[220px] rounded-2xl bg-black/60 border border-[#d1fe17]/20 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs font-semibold text-white/90">
            <span className="flex items-center gap-1.5">
              <svg className="size-3.5 text-[#d1fe17]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              Marketing
            </span>
          </div>
          <div className="mt-2 text-[10px] text-white/60">
            Ms. Higgs • 480M subscribers
          </div>
          <div className="mt-2 flex gap-1.5 overflow-hidden">
            <div className="h-14 w-full rounded-md bg-white/10 border border-white/10" />
          </div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#d1fe17] px-2.5 py-0.5 text-[10px] font-bold text-black">
            <span>Analyzing hooks</span>
          </div>
        </div>

        {/* Decorative Floating Cards (Right Bottom) */}
        <div className="hidden lg:block absolute right-24 bottom-6 z-10 w-[200px] rounded-xl bg-black/60 border border-white/10 p-2.5 backdrop-blur-md">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <svg className="size-3.5 text-[#d1fe17]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
            <span>Production</span>
          </div>
        </div>

        {/* Center Main Content */}
        <div className="relative z-20 flex flex-col items-center justify-center gap-6 px-4 text-center lg:gap-8 max-w-2xl">
          <div className="flex flex-col items-center gap-3">
            {/* Logo Image */}
            <img
              src="/Klon kopya fotos _videos/supercomputer_banner_assets/spc_banner_logo.png"
              alt="Supercomputer Logo"
              className="w-[280px] max-w-[85%] aspect-[527/108] object-contain sm:w-[380px] lg:w-[460px] drop-shadow-[0_0_20px_rgba(209,254,23,0.4)]"
            />

            {/* Title & Subtitle */}
            <div className="flex flex-col items-center gap-2">
              <h2 className="font-grotesk text-[32px] font-bold uppercase leading-[36px] tracking-[-1px] text-[#d1fe17] sm:text-[44px] sm:leading-[1.05] lg:text-[54px]">
                Supercomputer
              </h2>
              <p className="text-xs font-medium tracking-[0.2px] text-[#c5d9a2] sm:text-base sm:tracking-normal">
                One superagent for your entire creative stack
              </p>
            </div>
          </div>

          {/* Call to Action Button */}
          <a
            href="/supercomputer"
            className="relative inline-flex items-center justify-center rounded-[12px] bg-white px-6 pb-[12px] pt-[10px] text-sm font-semibold tracking-[0.1px] text-[#1a1a1a] shadow-[0_9px_22px_0_rgba(0,0,0,0.25),inset_0_-3px_0_0_#c7c7c7] transition-transform duration-200 hover:scale-105 active:scale-95 sm:text-base sm:tracking-normal"
          >
            Try Supercomputer
          </a>
        </div>
      </section>
    </div>
  );
}

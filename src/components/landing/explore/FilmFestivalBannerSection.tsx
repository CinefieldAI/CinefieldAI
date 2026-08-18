export default function FilmFestivalBannerSection() {
  return (
    <div className="w-full pt-6">
      {/* Main Banner Container */}
      <div className="relative z-20 flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-black transition-colors duration-200 ease-in-out md:rounded-3xl md:shadow-[0_0_2rem_rgba(0,0,0,0.8)]">
        {/* Background Gradients & Glows */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(234,217,163,0.22)_0%,rgba(159,135,84,0.1)_32%,rgba(0,0,0,0)_72%)] md:bg-[radial-gradient(ellipse_at_82%_0%,rgba(234,217,163,0.34)_0%,rgba(159,135,84,0.16)_30%,rgba(0,0,0,0)_68%)]" />
          <div className="absolute -right-24 -top-56 hidden h-[42rem] w-[52rem] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(234,217,163,0.24)_0%,rgba(142,115,58,0.1)_43%,rgba(0,0,0,0)_72%)] blur-3xl md:block" />
          <div className="absolute inset-y-0 left-0 hidden w-full bg-[linear-gradient(90deg,#000_0%,#000_44%,rgba(0,0,0,0.72)_62%,rgba(0,0,0,0)_100%)] md:block" />
          
          {/* Award Trophy Image */}
          <img
            sizes="(min-width: 1408px) 720px, (min-width: 768px) 51vw, 0px"
            alt="Higgsfield Global Film Festival Award"
            loading="eager"
            decoding="async"
            className="absolute bottom-12 right-[min(2.7%,2.375rem)] hidden h-auto w-[min(51.14%,45rem)] max-w-none object-contain md:block z-10"
            src="https://static.higgsfield.ai/film-festival/main-festival-banner-award.webp"
          />
        </div>

        {/* Content Body */}
        <div className="relative z-10 flex min-h-[26rem] md:min-h-[30rem] w-full flex-col items-start justify-center p-6 md:p-10 lg:w-[58%]">
          {/* Badges */}
          <div className="mb-6 flex items-center gap-2">
            <span className="relative inline-flex items-center gap-1.5 rounded-full bg-[#D1FE17]/15 px-3 py-1 text-xs font-semibold text-[#D1FE17] border border-[#D1FE17]/30">
              <span className="h-2 w-2 rounded-full bg-[#D1FE17] animate-pulse" />
              Live now
            </span>
            <span className="relative inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 border border-white/15">
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              16 days left
            </span>
          </div>

          {/* Title & Laurels */}
          <div className="mb-6 flex w-full flex-col items-center md:items-start text-center md:text-left">
            <div className="flex items-center gap-4">
              <img
                alt=""
                width="36"
                height="96"
                draggable={false}
                className="shrink-0 -scale-x-100 h-16 md:h-24 w-auto"
                src="/film-festival/main-festival-banner-laurel.svg"
              />
              <div className="flex flex-col items-center md:items-start">
                <h2 className="font-semibold text-xs md:text-lg tracking-wide uppercase bg-[linear-gradient(90deg,#9F8754_0%,#EAD9A3_42.308%,#8E733A_100%)] bg-clip-text text-transparent">
                  Higgsfield Global Film Festival is open
                </h2>
                <p className="font-grotesk font-black text-4xl md:text-7xl uppercase tracking-tight bg-[linear-gradient(90deg,#9F8754_0%,#EAD9A3_42.308%,#8E733A_100%)] bg-clip-text text-transparent">
                  $1,000,000
                </p>
              </div>
              <img
                alt=""
                width="36"
                height="96"
                draggable={false}
                className="shrink-0 h-16 md:h-24 w-auto"
                src="/film-festival/main-festival-banner-laurel.svg"
              />
            </div>
            <p className="mt-3 text-xs md:text-sm text-white/60">
              Make your film in Cinema Studio and submit by Sep 3
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <a
              href="/generate"
              className="inline-flex items-center gap-2 rounded-xl bg-[#D1FE17] px-5 py-3 text-sm font-bold text-black shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              <span>Start my film</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 18.25L15.75 12L9.5 5.75" />
              </svg>
            </a>
            <a
              href="/contests/higgsfield-global-film-festival"
              className="inline-flex items-center rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white border border-white/15 backdrop-blur-xl transition-all hover:bg-white/20 active:scale-95"
            >
              Learn more
            </a>
          </div>
        </div>

        {/* Bottom Gold Credits Bar */}
        <div className="relative z-20 flex w-full flex-col items-center justify-between gap-4 border-t border-[#9F8754]/30 bg-gradient-to-r from-[#9F8754]/30 via-[#EAD9A3]/20 to-[#8E733A]/30 p-4 md:flex-row md:px-8">
          <div className="flex flex-col text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 text-sm font-bold text-[#EAD9A3]">
              <span>Build in public</span>
              <span>→</span>
              <span>Win credits</span>
              <span>→</span>
              <span>Make a better film</span>
            </div>
            <p className="text-xs text-white/60">
              More credits mean more attempts, a better film, and a better shot at the $1,000,000.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/40 px-3 py-1.5 border border-[#EAD9A3]/30">
              <span className="text-xs font-bold text-[#EAD9A3]">100 000</span>
              <span className="text-[10px] uppercase text-white/70">for public projects</span>
            </div>
            <a
              href="/generate"
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              Create a public project
            </a>
            <a
              href="/contests/higgsfield-global-film-festival"
              className="rounded-lg bg-black/50 px-3 py-1.5 text-xs font-semibold text-white border border-white/20 transition-opacity hover:bg-black/70"
            >
              Learn more
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

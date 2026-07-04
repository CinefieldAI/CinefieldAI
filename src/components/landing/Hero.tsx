import { ArrowRight, Play } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-white/10">
      {/* Ambient background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-10%] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-lime-500/20 via-emerald-500/10 to-transparent blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_60%)]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-20 pb-12 text-center lg:pt-28">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-300">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-300" />
          Now generating in native 4K
        </span>

        <h1 className="mx-auto max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
          SEEDANCE 2.0 4K
          <br />
          <span className="text-zinc-500">IN NATIVE 4K</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-base text-zinc-400 sm:text-lg">
          Direct full-motion cinematic sequences with native 4K fidelity,
          precision camera control, and studio-grade consistency&nbsp;
          all from a single prompt.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            className="group flex items-center gap-2 rounded-full bg-lime-300 px-6 py-3 text-sm font-semibold text-black shadow-[0_0_30px_rgba(190,242,100,0.3)] transition-transform hover:scale-[1.03] hover:bg-lime-200"
          >
            Try now
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/5"
          >
            <Play className="h-4 w-4" />
            Watch demo
          </button>
        </div>

        {/* Showcase frame */}
        <div className="relative mx-auto mt-14 max-w-5xl">
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black shadow-2xl">
            <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(190,242,100,0.12),transparent_40%,transparent_60%,rgba(16,185,129,0.12))]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                aria-label="Play preview"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform hover:scale-110"
              >
                <Play className="h-6 w-6 text-white" fill="white" />
              </button>
            </div>
            <div className="absolute bottom-4 left-4 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-md">
              4K · 24fps · Seedance 2.0
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Motion Control tab — right column's closed-state view (shown on the
 * "Motion library" tab whenever the 3-step tutorial is closed). Reference
 * microcopy reproduced exactly.
 */
export default function MotionLibraryView() {
  return (
    <section className="flex min-h-[420px] w-full flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#181a1c] px-6 py-16 text-center">
      <h1 className="max-w-xl text-2xl font-bold uppercase text-white sm:text-3xl">
        RECREATE ANY MOTION WITH YOUR IMAGE
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-5 text-zinc-500">
        Copy motion from any video and place your character into the same
        movement
      </p>
      <button
        type="button"
        className="mt-6 rounded-xl bg-[#D97757] px-4 py-2.5 text-sm font-bold text-black shadow-[0_5px_0_#934c36] transition-transform active:translate-y-0.5"
      >
        Start by copying motion from library
      </button>
    </section>
  );
}

import { Flame, ImageIcon } from "lucide-react";

const GRADIENTS = [
  "from-fuchsia-500/40 via-purple-600/30 to-black",
  "from-amber-500/40 via-orange-600/30 to-black",
  "from-sky-500/40 via-blue-600/30 to-black",
  "from-emerald-500/40 via-teal-600/30 to-black",
  "from-rose-500/40 via-pink-600/30 to-black",
  "from-indigo-500/40 via-violet-600/30 to-black",
  "from-lime-500/40 via-green-600/30 to-black",
  "from-cyan-500/40 via-sky-600/30 to-black",
];

const PRESETS = [
  { title: "Cinematic Portrait", count: "182K" },
  { title: "Neon Cyberpunk", count: "97K" },
  { title: "Studio Product", count: "64K" },
  { title: "Anime Key Visual", count: "211K" },
  { title: "Editorial Fashion", count: "73K" },
  { title: "Fantasy Landscape", count: "145K" },
  { title: "Retro Film", count: "58K" },
  { title: "Architectural Render", count: "39K" },
];

export default function PresetsGallery() {
  return (
    <section className="border-b border-white/10">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Community Presets
            </h2>
            <p className="mt-2 max-w-lg text-zinc-400">
              Premium generations crafted by the community. Remix any preset
              with one click.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
          >
            View all presets
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {PRESETS.map((preset, idx) => (
            <div
              key={preset.title}
              className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${GRADIENTS[idx % GRADIENTS.length]} transition-transform duration-500 group-hover:scale-110`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="h-8 w-8 text-white/30" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3.5">
                <p className="text-sm font-semibold text-white">
                  {preset.title}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-300">
                  <Flame className="h-3 w-3 text-lime-300" />
                  {preset.count} generations
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

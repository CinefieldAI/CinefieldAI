import { ImageIcon } from "lucide-react";

const TILES = [
  { span: "row-span-2", gradient: "from-orange-500/35 via-rose-600/25 to-black" },
  { span: "", gradient: "from-blue-500/35 via-indigo-600/25 to-black" },
  { span: "", gradient: "from-emerald-500/35 via-teal-600/25 to-black" },
  { span: "row-span-2", gradient: "from-violet-500/35 via-purple-600/25 to-black" },
  { span: "", gradient: "from-yellow-500/35 via-amber-600/25 to-black" },
  { span: "", gradient: "from-cyan-500/35 via-sky-600/25 to-black" },
  { span: "row-span-2", gradient: "from-pink-500/35 via-fuchsia-600/25 to-black" },
  { span: "", gradient: "from-lime-500/35 via-green-600/25 to-black" },
  { span: "", gradient: "from-red-500/35 via-orange-600/25 to-black" },
  { span: "", gradient: "from-teal-500/35 via-cyan-600/25 to-black" },
];

export default function PhotodumpShowcase() {
  return (
    <section className="border-b border-white/10">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10 text-center">
          <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
            Photodump
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            A feed of everything the community made today.
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 [grid-auto-rows:140px]">
          {TILES.map((tile, idx) => (
            <div
              key={idx}
              className={`group relative overflow-hidden rounded-xl border border-white/10 ${tile.span}`}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${tile.gradient} transition-transform duration-500 group-hover:scale-110`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-white/25" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Clapperboard, Sparkles, User } from "lucide-react";

const SOUL_TILES = [
  "from-rose-500/40 to-black",
  "from-amber-500/40 to-black",
  "from-sky-500/40 to-black",
  "from-emerald-500/40 to-black",
];

const CINEMA_TILES = [
  "from-indigo-600/40 to-black",
  "from-purple-600/40 to-black",
  "from-cyan-600/40 to-black",
  "from-fuchsia-600/40 to-black",
];

function GridBlock({
  badge,
  title,
  desc,
  tiles,
  icon: Icon,
}: {
  badge: string;
  title: string;
  desc: string;
  tiles: string[];
  icon: typeof Sparkles;
}) {
  return (
    <div className="flex-1">
      <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
        <Icon className="h-3.5 w-3.5 text-lime-300" />
        {badge}
      </span>
      <h3 className="mt-4 text-2xl font-bold tracking-tight text-white">
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-sm text-zinc-400">{desc}</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {tiles.map((gradient, idx) => (
          <div
            key={idx}
            className="group relative aspect-square overflow-hidden rounded-xl border border-white/10"
          >
            <div
              className={`absolute inset-0 bg-gradient-to-br ${gradient} transition-transform duration-500 group-hover:scale-110`}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <User className="h-6 w-6 text-white/25" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SoulGrids() {
  return (
    <section className="border-b border-white/10 bg-zinc-950/40">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex flex-col gap-14 md:flex-row md:gap-10">
          <GridBlock
            badge="Soul 2.0"
            title="Consistent characters, every frame."
            desc="Lock identity across generations with Soul 2.0's character-consistency engine."
            tiles={SOUL_TILES}
            icon={Sparkles}
          />
          <GridBlock
            badge="Soul Cinema"
            title="Direct full scenes, not just stills."
            desc="Extend Soul's consistency into multi-shot cinematic sequences."
            tiles={CINEMA_TILES}
            icon={Clapperboard}
          />
        </div>
      </div>
    </section>
  );
}

import { ImageIcon } from "lucide-react";
import ViewHeader from "./ViewHeader";

const TAGS = ["Cinematic", "Pastel", "High contrast", "Editorial", "Night", "Film grain"];

const TILES = [
  { span: "row-span-2", gradient: "from-rose-500/30 via-pink-600/20 to-black" },
  { span: "", gradient: "from-amber-500/30 via-orange-600/20 to-black" },
  { span: "", gradient: "from-sky-500/30 via-blue-600/20 to-black" },
  { span: "", gradient: "from-emerald-500/30 via-teal-600/20 to-black" },
  { span: "row-span-2", gradient: "from-violet-500/30 via-purple-600/20 to-black" },
  { span: "", gradient: "from-magenta-500/30 via-fuchsia-600/20 to-black" },
  { span: "", gradient: "from-cyan-500/30 via-sky-600/20 to-black" },
  { span: "", gradient: "from-lime-500/30 via-green-600/20 to-black" },
];

export default function MoodboardView({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <ViewHeader
        badge="Moodboard"
        title="Collect references into a visual brief"
        description="Pin references, tag a palette, and carry the mood straight into generation."
        onBack={onBack}
      />

      <div className="grid grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[200px_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Tags
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {TAGS.map((tag, idx) => (
              <span
                key={tag}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  idx === 0
                    ? "bg-magenta-500/15 text-magenta-400"
                    : "bg-white/5 text-zinc-400"
                }`}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 [grid-auto-rows:120px]">
          {TILES.map((tile, idx) => (
            <div
              key={idx}
              className={`group relative overflow-hidden rounded-xl border border-white/10 ${tile.span}`}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${tile.gradient} transition-transform duration-500 group-hover:scale-110`}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-white/25" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

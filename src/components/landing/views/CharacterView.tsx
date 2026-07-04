import { Fingerprint, User } from "lucide-react";
import ViewHeader from "./ViewHeader";

export default function CharacterView({ onBack }: { onBack: () => void }) {
  const consistency = 94;

  return (
    <div>
      <ViewHeader
        badge="Soul ID Character"
        title="Lock a consistent identity across shots"
        description="Anchor a character's face, build, and style once — reuse it across every generation."
        onBack={onBack}
      />

      <div className="grid grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex aspect-[3/4] items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
            <User className="h-10 w-10 text-white/20" />
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Fingerprint className="h-3.5 w-3.5 text-magenta-400" />
                Identity consistency
              </span>
              <span className="font-mono text-zinc-300">{consistency}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-magenta-500 to-magenta-600"
                style={{ width: `${consistency}%` }}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Generated set
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="flex aspect-square items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-zinc-800 to-zinc-950"
              >
                <User className="h-4 w-4 text-white/20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

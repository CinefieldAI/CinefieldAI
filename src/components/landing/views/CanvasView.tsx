import {
  Hand,
  Layers,
  MousePointer2,
  Shapes,
  Square,
  Type,
} from "lucide-react";
import ViewHeader from "./ViewHeader";

const TOOLS = [MousePointer2, Hand, Type, Shapes, Square];

export default function CanvasView({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <ViewHeader
        badge="Canvas"
        title="Freeform creative workspace"
        description="Compose, arrange, and iterate on generations directly on an infinite canvas."
        onBack={onBack}
      />

      <div className="grid grid-cols-1 gap-4 px-6 py-8 lg:grid-cols-[64px_1fr_240px]">
        <div className="flex flex-row gap-2 lg:flex-col">
          {TOOLS.map((Icon, idx) => (
            <button
              key={idx}
              type="button"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                idx === 0
                  ? "border-magenta-500/40 bg-magenta-500/10 text-magenta-400"
                  : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <div
          className="relative aspect-[16/10] w-full rounded-2xl border border-dashed border-white/15 bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:18px_18px]"
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-zinc-500">
              Drop assets or generate directly on the canvas
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Layers className="h-3.5 w-3.5" />
            Layers
          </div>
          <div className="mt-3 space-y-1.5">
            {["Background", "Subject", "Lighting pass", "Annotations"].map(
              (layer, idx) => (
                <div
                  key={layer}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    idx === 0
                      ? "bg-magenta-500/10 text-magenta-400"
                      : "text-zinc-400 hover:bg-white/5"
                  }`}
                >
                  {layer}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

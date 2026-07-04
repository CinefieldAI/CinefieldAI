import { Cpu, Gauge, Layers, Zap } from "lucide-react";

const STATS = [
  { icon: Cpu, label: "Compute", value: "12,000+", suffix: "GPUs" },
  { icon: Zap, label: "Render speed", value: "4x", suffix: "faster" },
  { icon: Layers, label: "Concurrent jobs", value: "Unlimited", suffix: "" },
  { icon: Gauge, label: "Latency", value: "<1s", suffix: "queue" },
];

export default function Supercomputer() {
  return (
    <section className="border-b border-white/10 bg-zinc-950/40">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-lime-300/10 px-3 py-1 text-xs font-semibold text-lime-300">
              Supercomputer
              <span className="rounded-full bg-lime-300 px-1.5 py-0.5 text-[10px] text-black">
                New
              </span>
            </span>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              A dedicated render cluster, on demand.
            </h2>
            <p className="mt-4 max-w-lg text-zinc-400">
              Spin up reserved GPU capacity for batch generations, render
              farms, and high-volume pipelines no queues, no throttling,
              just raw throughput when your team needs it most.
            </p>
            <button
              type="button"
              className="mt-7 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.03]"
            >
              Explore Supercomputer
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {STATS.map((stat) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5"
                >
                  <Icon className="h-5 w-5 text-lime-300" />
                  <p className="mt-4 text-2xl font-bold text-white">
                    {stat.value}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {stat.label}
                    {stat.suffix && ` · ${stat.suffix}`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

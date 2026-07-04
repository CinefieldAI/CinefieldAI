import { LayoutTemplate, Megaphone, Sparkles, Target } from "lucide-react";

const ITEMS = [
  {
    icon: Target,
    title: "Audience-tuned creative",
    desc: "Generate ad variants tailored to platform, format, and audience segment.",
  },
  {
    icon: LayoutTemplate,
    title: "Brand-locked templates",
    desc: "Lock in your palette, fonts, and logo placement across every export.",
  },
  {
    icon: Sparkles,
    title: "One-click variations",
    desc: "Produce dozens of on-brand variants for testing in seconds.",
  },
];

export default function MarketingStudio() {
  return (
    <section className="border-b border-white/10 bg-zinc-950/40">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-purple-700/30 via-zinc-900 to-black order-2 lg:order-1">
            <div className="absolute inset-0 grid grid-cols-2 gap-3 p-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm"
                />
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Megaphone className="h-10 w-10 text-white/20" />
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
              Marketing Studio
            </span>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Campaign-ready creative, generated in minutes.
            </h2>
            <p className="mt-4 max-w-lg text-zinc-400">
              From product shots to full motion ads, Marketing Studio turns a
              single brief into a complete asset suite ready for every
              channel.
            </p>

            <div className="mt-8 space-y-5">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-300/10 text-lime-300">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

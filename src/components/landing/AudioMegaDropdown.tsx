"use client";

import { Badge } from "@/components/ui/badge";
import {
  AUDIO_FEATURES,
  AUDIO_MODELS,
  type AudioFeature,
  type AudioModel,
} from "./audioMenuData";

interface AudioMegaDropdownProps {
  onFeatureSelect?: (title: string) => void;
  onModelSelect?: (title: string) => void;
  /** Title of the currently active feature (drives the bottom rotary selector). */
  activeFeatureTitle?: string;
  /** Title of the currently active model (drives the prompt-bar model pill). */
  activeModelTitle?: string;
}

function AudioColumn({
  title,
  items,
  activeTitle,
  onSelect,
}: {
  title: string;
  items: (AudioFeature | AudioModel)[];
  activeTitle?: string;
  onSelect?: (title: string) => void;
}) {
  return (
    <section className="min-w-[18rem] p-2 pt-3 first-of-type:pr-0 last-of-type:pl-0">
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="grid auto-rows-min gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.title === activeTitle;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => onSelect?.(item.title)}
              aria-pressed={active}
              className="group grid grid-cols-[auto_1fr] items-center gap-3 rounded-2xl border border-transparent p-2 text-left no-underline transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04] active:brightness-[.6]"
            >
              <div className="grid size-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-400 transition-colors group-hover:bg-magenta-500/10 group-hover:text-magenta-400">
                <Icon className="size-6" />
              </div>
              <div className="grid min-w-0 auto-rows-min gap-1">
                <span className="flex items-center gap-1.5">
                  <span className="model-title truncate text-sm font-medium leading-5 text-white">
                    {item.title}
                  </span>
                  {item.badge && <Badge variant="new">{item.badge}</Badge>}
                  {active && (
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: "rgb(209,254,23)" }}
                    />
                  )}
                </span>
                <span className="truncate text-sm leading-5 text-[#898a8b]">
                  {item.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function AudioMegaDropdown({
  onFeatureSelect,
  onModelSelect,
  activeFeatureTitle,
  activeModelTitle,
}: AudioMegaDropdownProps) {
  return (
    <div
      className="w-[732px] max-w-[92vw] overflow-y-auto rounded-[24px] border border-white/[0.06] bg-[#1c1e20] p-1 shadow-2xl shadow-black/60"
      style={{ maxHeight: "calc(100dvh - 100px)" }}
    >
      <div className="grid grid-flow-col-dense">
        <AudioColumn
          title="Features"
          items={AUDIO_FEATURES}
          activeTitle={activeFeatureTitle}
          onSelect={onFeatureSelect}
        />
        <AudioColumn
          title="Models"
          items={AUDIO_MODELS}
          activeTitle={activeModelTitle}
          onSelect={onModelSelect}
        />
      </div>
    </div>
  );
}

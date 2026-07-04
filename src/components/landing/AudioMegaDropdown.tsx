"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AUDIO_FEATURES, AUDIO_MODELS, type AudioFeature } from "./audioMenuData";

interface AudioMegaDropdownProps {
  onFeatureSelect?: (title: string) => void;
  onModelSelect?: (title: string) => void;
}

function AudioColumn({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: AudioFeature[];
  onSelect?: (title: string) => void;
}) {
  return (
    <div className="p-3">
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="flex flex-col">
        {items.map((item, idx) => {
          const Icon = item.icon;
          return (
            <Fragment key={item.title}>
              <button
                type="button"
                onClick={() => onSelect?.(item.title)}
                className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-colors group-hover:bg-magenta-500/10 group-hover:text-magenta-400">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-white">
                      {item.title}
                    </span>
                    {item.badge && <Badge variant="new">{item.badge}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {item.description}
                  </span>
                </span>
              </button>
              {idx < items.length - 1 && <Separator className="my-0.5" />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function AudioMegaDropdown({
  onFeatureSelect,
  onModelSelect,
}: AudioMegaDropdownProps) {
  return (
    <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0B0B0C] shadow-2xl shadow-black/60">
      <div className="grid grid-cols-2">
        <AudioColumn title="Features" items={AUDIO_FEATURES} onSelect={onFeatureSelect} />
        <div className="border-l border-white/[0.06]">
          <AudioColumn title="Models" items={AUDIO_MODELS} onSelect={onModelSelect} />
        </div>
      </div>
    </div>
  );
}

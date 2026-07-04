"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { VIDEO_DROPDOWN_MODELS, VIDEO_FEATURES } from "./videoMenuData";

interface VideoMegaDropdownProps {
  onFeatureSelect?: (title: string) => void;
  onModelSelect?: (name: string) => void;
}

function badgeVariant(badge: "TOP" | "NEW") {
  return badge === "TOP" ? "top" : "new";
}

export default function VideoMegaDropdown({
  onFeatureSelect,
  onModelSelect,
}: VideoMegaDropdownProps) {
  return (
    <div className="w-[880px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0B0B0C] shadow-2xl shadow-black/60">
      <div className="grid grid-cols-[1.2fr_1fr]">
        {/* LEFT: Features */}
        <div className="p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Features
          </p>
          <div className="flex flex-col">
            {VIDEO_FEATURES.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <Fragment key={feature.title}>
                  <button
                    type="button"
                    onClick={() => onFeatureSelect?.(feature.title)}
                    className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-colors group-hover:bg-magenta-500/10 group-hover:text-magenta-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-white">
                          {feature.title}
                        </span>
                        {feature.badge && (
                          <Badge variant={badgeVariant(feature.badge)}>
                            {feature.badge}
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {feature.description}
                      </span>
                    </span>
                  </button>
                  {idx < VIDEO_FEATURES.length - 1 && <Separator className="my-0.5" />}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Models */}
        <div className="border-l border-white/[0.06] p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Models
          </p>
          <div className="flex flex-col gap-2">
            {VIDEO_DROPDOWN_MODELS.map((model) => (
              <button
                key={model.name}
                type="button"
                onClick={() => onModelSelect?.(model.name)}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 text-[10px] font-semibold text-zinc-300 transition-colors group-hover:from-magenta-500/40 group-hover:to-magenta-600/40 group-hover:text-white">
                  {model.name.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 truncate text-xs font-medium text-zinc-200">
                    {model.name}
                    {model.badge && (
                      <Badge variant={badgeVariant(model.badge)} className="px-1">
                        {model.badge}
                      </Badge>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {model.meta}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Fragment } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { IMAGE_DROPDOWN_MODELS, IMAGE_FEATURES, type ImageFeatureKey } from "./imageDropdownData";

interface ImageMegaDropdownProps {
  onFeatureSelect: (key: ImageFeatureKey) => void;
  onModelSelect: (name: string) => void;
}

export default function ImageMegaDropdown({
  onFeatureSelect,
  onModelSelect,
}: ImageMegaDropdownProps) {
  return (
    <div className="w-[820px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0B0B0C] shadow-2xl shadow-black/60">
      <div className="grid grid-cols-[1.2fr_1fr]">
        {/* LEFT: Features */}
        <div className="p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Features
          </p>
          <div className="flex flex-col">
            {IMAGE_FEATURES.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <Fragment key={feature.key}>
                  <button
                    type="button"
                    onClick={() => onFeatureSelect(feature.key)}
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
                          <Badge variant={feature.badge === "New" ? "new" : "pro"}>
                            {feature.badge}
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {feature.description}
                      </span>
                    </span>
                  </button>
                  {idx < IMAGE_FEATURES.length - 1 && (
                    <Separator className="my-0.5" />
                  )}
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
          <div className="flex flex-col gap-1">
            {IMAGE_DROPDOWN_MODELS.map((model) => (
              <button
                key={model.name}
                type="button"
                onClick={() => onModelSelect(model.name)}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[#00e5ff]/20 hover:bg-white/[0.04]"
              >
                {model.icon ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                    <Image
                      src={model.icon}
                      alt={model.name}
                      width={24}
                      height={24}
                      className="h-full w-full object-cover"
                    />
                  </span>
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 text-[10px] font-semibold text-zinc-300 transition-colors group-hover:from-magenta-500/40 group-hover:to-magenta-600/40 group-hover:text-white">
                    {model.name.charAt(0)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-zinc-200">
                    {model.name}
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

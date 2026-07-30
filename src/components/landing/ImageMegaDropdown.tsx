"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
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
    <div
      className="w-[732px] max-w-[92vw] overflow-y-auto rounded-[24px] border border-white/[0.06] bg-[#1c1e20] p-1 shadow-2xl shadow-black/60"
      style={{ maxHeight: "calc(100dvh - 100px)" }}
    >
      <div className="grid grid-flow-col-dense">
        {/* LEFT: Features */}
        <section className="min-w-[18rem] p-2 pt-3 first-of-type:pr-0 last-of-type:pl-0">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Features
          </p>
          <div className="grid auto-rows-min gap-0.5">
            {IMAGE_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <button
                  key={feature.key}
                  type="button"
                  onClick={() => onFeatureSelect(feature.key)}
                  className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-2xl p-2 text-left no-underline transition-colors hover:bg-[#131517] active:brightness-[.6]"
                >
                  <div className="grid size-14 shrink-0 items-center justify-center rounded-xl bg-[#23262a]">
                    <Icon className="size-7 text-zinc-300" />
                  </div>
                  <div className="grid min-w-0 auto-rows-min gap-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[18px] font-semibold leading-6 text-white">
                        {feature.title}
                      </span>
                      {feature.badge && (
                        <Badge variant={feature.badge === "New" ? "new" : "pro"}>
                          {feature.badge}
                        </Badge>
                      )}
                    </span>
                    <span className="truncate text-xs font-medium leading-5 text-zinc-400">
                      {feature.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* RIGHT: Models */}
        <section className="min-w-[18rem] p-2 pt-3 first-of-type:pr-0 last-of-type:pl-0">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Models
          </p>
          <div className="grid auto-rows-min gap-0.5">
            {IMAGE_DROPDOWN_MODELS.map((model) => {
              const Icon = typeof model.icon === "string" ? null : model.icon;
              return (
                <button
                  key={model.name}
                  type="button"
                  onClick={() => onModelSelect(model.name)}
                  className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-2xl p-2 text-left no-underline transition-colors hover:bg-[#131517] active:brightness-[.6]"
                >
                  <div className="grid size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#23262a]">
                    {typeof model.icon === "string" ? (
                      <Image
                        src={model.icon}
                        alt=""
                        width={24}
                        height={24}
                        className="size-7 object-contain"
                      />
                    ) : (
                      Icon && <Icon className="size-7 text-zinc-300" aria-hidden="true" />
                    )}
                  </div>
                  <div className="grid min-w-0 auto-rows-min gap-1">
                    <span className="truncate text-[18px] font-semibold leading-6 text-white">
                      {model.name}
                    </span>
                    <span className="truncate text-xs font-medium leading-5 text-zinc-400">
                      {model.meta}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

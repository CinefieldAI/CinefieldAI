"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search, Sparkles } from "lucide-react";
import ModelItem from "./ModelItem";
import { ALL_MODELS, FEATURED_MODELS } from "./createImageData";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";

interface ModelSelectorProps {
  selected: string;
  onSelect: (name: string) => void;
  size?: "compact" | "large" | "mini";
  portalContainer?: HTMLElement | null;
}

export default function ModelSelector({
  selected,
  onSelect,
  size = "compact",
  portalContainer,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allModelsCombined = [...FEATURED_MODELS, ...ALL_MODELS];
  const selectedModelObj = allModelsCombined.find((m) => m.name === selected);
  const sharedTriggerIcon = getSharedModelIcon(selected);
  const SelectedIconComp =
    sharedTriggerIcon ??
    (typeof selectedModelObj?.icon === "function" ? selectedModelObj.icon : null);
  const selectedIconPath =
    typeof selectedModelObj?.icon === "string" ? selectedModelObj.icon : null;

  const handleSelect = (name: string) => {
    onSelect(name);
    setOpen(false);
    setQuery("");
  };

  const q = query.trim().toLowerCase();
  const filterModel = (m: (typeof FEATURED_MODELS)[number]) =>
    !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);

  const filteredFeatured = FEATURED_MODELS.filter(filterModel);
  const filteredAll = ALL_MODELS.filter(filterModel);
  const hasNoResults = filteredFeatured.length === 0 && filteredAll.length === 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Model: ${selected}`}
          className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 ease-out focus:outline-none ${
            open
              ? "border-[#D97757] bg-[#181a1d] shadow-[0_0_12px_rgba(217,119,87,0.40)]"
              : "border-[rgba(217,119,87,0.45)] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
          }`}
        >
          {SelectedIconComp ? (
            <SelectedIconComp className="h-4 w-4 text-[#D97757]" />
          ) : selectedIconPath ? (
            <img src={selectedIconPath} alt="" className="h-4 w-4 object-contain" />
          ) : (
            <Sparkles className="h-4 w-4 text-[#D97757]" />
          )}
          <span className="max-w-[140px] truncate text-white">{selected}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
              open ? "rotate-180 text-[#D97757]" : "text-neutral-400"
            }`}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          data-page="image"
          data-image-model-dropdown="true"
          className="outline-none z-[100000] rounded-2xl border border-white/[0.08] bg-[rgba(25,27,30,0.76)] backdrop-blur-[28px] backdrop-saturate-[125%] shadow-[0_20px_60px_rgba(0,0,0,0.45)] flex flex-col pointer-events-auto transition-all duration-[170ms] ease-out origin-bottom animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <div className="relative rounded-2xl flex flex-col overflow-hidden w-96 max-w-[calc(100vw-32px)] h-[520px] max-h-[var(--radix-popover-content-available-height,520px)]">
            {/* Top ambient orange/cyan glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 w-full h-[40px] z-0 rounded-[317px] bg-[rgba(217,119,87,0.15)] blur-[50px]"
            />

            {/* Search Header Container (Glass Field) */}
            <div className="relative z-10 p-2.5 pb-1">
              <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 transition-all duration-200 focus-within:border-[#D97757]/60 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_12px_rgba(217,119,87,0.25)]">
                <Search className="size-4 shrink-0 text-white/40 group-focus-within/search:text-[#F19A72] group-focus-within/search:drop-shadow-[0_0_5px_rgba(217,119,87,0.5)] transition-colors duration-200" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models..."
                  aria-label="Search models"
                  className="w-full bg-transparent text-xs font-medium text-white placeholder:text-white/35 outline-none"
                />
              </div>
            </div>

            {/* Internal scroll area with professional thin scrollbar */}
            <div
              className="relative z-10 flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent] hover:[scrollbar-color:rgba(217,119,87,0.45)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#D97757]/50 transition-colors"
              role="listbox"
              aria-label="AI models"
              onWheel={(e) => e.stopPropagation()}
            >
              {hasNoResults && (
                <p className="px-3 py-8 text-center text-xs text-white/40">
                  No models match &quot;{query}&quot;.
                </p>
              )}

              {/* Featured Models Section */}
              {filteredFeatured.length > 0 && (
                <div className="mb-3">
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider uppercase text-white/40">
                    <Sparkles className="size-3 text-[#D97757]" />
                    Featured Models
                  </p>
                  <div className="space-y-1.5">
                    {filteredFeatured.map((model) => (
                      <ModelItem
                        key={`featured-${model.id}`}
                        model={model}
                        isSelected={selected === model.name}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* All Models Section */}
              {filteredAll.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider uppercase text-white/40">
                    <Sparkles className="size-3 text-white/30" />
                    All Models
                  </p>
                  <div className="space-y-1.5">
                    {filteredAll.map((model) => (
                      <ModelItem
                        key={`all-${model.id}`}
                        model={model}
                        isSelected={selected === model.name}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

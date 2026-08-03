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
          className="outline-none z-[100000] rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,30,32,0.95)] shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-2xl flex flex-col pointer-events-auto transition-all duration-200 ease-out origin-bottom"
        >
          <div className="relative rounded-2xl flex flex-col overflow-hidden w-96 max-w-[calc(100vw-32px)] h-[520px] max-h-[var(--radix-popover-content-available-height,520px)]">
            {/* Top glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 w-full h-[37px] z-0 rounded-[317px] bg-[rgba(139,213,244,0.24)] blur-[50px]"
            />

            {/* Search header */}
            <div className="relative z-10 flex h-[41px] min-h-[41px] items-center gap-2 border-b border-white/10 bg-transparent px-3">
              <Search className="size-4 shrink-0 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                aria-label="Search models"
                className="w-full bg-transparent text-sm text-white placeholder:text-gray-400 outline-none"
              />
            </div>

            {/* Internal scroll area with hidden scrollbar track */}
            <div
              className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
              role="listbox"
              aria-label="AI models"
              onWheel={(e) => e.stopPropagation()}
            >
              {hasNoResults && (
                <p className="px-3 py-6 text-center text-xs text-neutral-400">
                  No models match &quot;{query}&quot;.
                </p>
              )}

              {/* Featured Models Section */}
              {filteredFeatured.length > 0 && (
                <div className="mb-3">
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-2 text-xs font-medium text-gray-400">
                    <Sparkles className="size-3 text-[#D97757]" />
                    Featured Models
                  </p>
                  <div className="space-y-1">
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
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-2 text-xs font-medium text-gray-400">
                    <Sparkles className="size-3 text-gray-400" />
                    All Models
                  </p>
                  <div className="space-y-1">
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

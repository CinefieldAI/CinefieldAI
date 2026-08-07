"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search, Sparkles } from "lucide-react";
import ModelItem from "./ModelItem";
import { ALL_MODELS, FEATURED_MODELS, type CreateImageModel } from "./createImageData";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";
import { BLOCKED_MODEL_LABEL_CLASS, isBlockedModelLabel } from "@/lib/blockedModels";

interface ModelSelectorProps {
  selected: string;
  onSelect: (name: string) => void;
  size?: "compact" | "large" | "mini";
  portalContainer?: HTMLElement | null;
}

const CATEGORY_SOURCES = [
  { label: "Featured models", models: FEATURED_MODELS },
  { label: "All models", models: ALL_MODELS },
];

export default function ModelSelector({
  selected,
  onSelect,
  size = "compact",
  portalContainer,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const allModelsCombined = useMemo(() => [...FEATURED_MODELS, ...ALL_MODELS], []);
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

  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [open]);

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!selected) return CATEGORY_SOURCES;

      // 1. Flatten all models with their category label in canonical original order
      const allFlatModels: { model: CreateImageModel; categoryLabel: string }[] = [];
      for (const cat of CATEGORY_SOURCES) {
        for (const m of cat.models) {
          allFlatModels.push({ model: m, categoryLabel: cat.label });
        }
      }

      // 2. Find selected model index
      const selectedIdx = allFlatModels.findIndex(
        (item) => item.model.name === selected || item.model.id === selected
      );

      if (selectedIdx < 0) return CATEGORY_SOURCES;

      // 3. Rotate model list so selected model is first, followed by original next items, then wrapped start items
      const rotatedList = [
        ...allFlatModels.slice(selectedIdx),
        ...allFlatModels.slice(0, selectedIdx),
      ];

      // 4. Group consecutive models belonging to the same category
      const rotatedCategories: { label: string; models: CreateImageModel[] }[] = [];
      for (const item of rotatedList) {
        const lastCat = rotatedCategories[rotatedCategories.length - 1];
        if (lastCat && lastCat.label === item.categoryLabel) {
          lastCat.models.push(item.model);
        } else {
          rotatedCategories.push({
            label: item.categoryLabel,
            models: [item.model],
          });
        }
      }

      return rotatedCategories;
    }

    const match = (m: CreateImageModel) =>
      m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);

    return CATEGORY_SOURCES.map((c) => ({
      ...c,
      models: c.models.filter(match),
    })).filter((c) => c.models.length > 0);
  }, [query, selected]);

  const flatIndexByName = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    categories.forEach((cat) => {
      cat.models.forEach((m) => {
        if (!map.has(m.name)) {
          map.set(m.name, idx);
          idx += 1;
        }
      });
    });
    return map;
  }, [categories]);

  const hasNoResults = categories.length === 0;

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
              ? "border-[#D97757] bg-[#181a1d]"
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
          <span
            className={`max-w-[140px] truncate ${
              isBlockedModelLabel(selected) ? BLOCKED_MODEL_LABEL_CLASS : "text-white"
            }`}
          >
            {selected}
          </span>
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
              <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 transition-all duration-200 focus-within:border-[#D97757]/60 focus-within:bg-white/[0.06]">
                <Search className="size-4 shrink-0 text-white/40 transition-colors duration-200 group-focus-within/search:text-[#F19A72]" />
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

            {/* Internal scroll area — stays scrollable (wheel/trackpad/touch/
                keyboard) with the scrollbar track and thumb hidden, matching
                the rest of the app's panels via globals.css `.hide-scrollbar`. */}
            <div
              ref={scrollContainerRef}
              className="hide-scrollbar relative z-10 flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-1 transition-colors"
              role="listbox"
              aria-label="AI models"
              onWheel={(e) => e.stopPropagation()}
            >
              {hasNoResults && (
                <p className="px-3 py-8 text-center text-xs text-white/40">
                  No models match &quot;{query}&quot;.
                </p>
              )}

              {categories.map((cat, catIdx) => {
                const isAll = cat.label.toLowerCase().includes("all");
                return (
                  <div key={`${cat.label}-${catIdx}`} className="mb-3">
                    <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-xs font-medium text-white/40">
                      {isAll ? (
                        <svg
                          aria-hidden="true"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="size-3.5 text-white/40 shrink-0"
                        >
                          <path
                            d="M14.25 6.75C13.0074 6.75 12 7.75736 12 9C12 10.2426 13.0074 11.25 14.25 11.25C15.4926 11.25 16.5 10.2426 16.5 9C16.5 7.75736 15.4926 6.75 14.25 6.75Z"
                            fill="currentColor"
                          />
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M3 4.75C3 3.7835 3.7835 3 4.75 3H19.25C20.2165 3 21 3.7835 21 4.75V19.25C21 20.2165 20.2165 21 19.25 21H4.75C3.7835 21 3 20.2165 3 19.25V4.75ZM19.5 18.4394L14.8839 13.8232C14.3957 13.3351 13.6043 13.3351 13.1161 13.8232L12.1768 14.7626C12.0791 14.8602 11.9209 14.8602 11.8232 14.7626L8.87333 11.8127C8.3956 11.3349 7.62472 11.3233 7.13274 11.7863L4.5 14.2642V4.75C4.5 4.61193 4.61193 4.5 4.75 4.5H19.25C19.3881 4.5 19.5 4.61193 19.5 4.75V18.4394Z"
                            fill="currentColor"
                          />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="size-3.5 text-white/40 shrink-0"
                        >
                          <path
                            d="M12.7368 2.60967C12.6694 2.25593 12.3601 2 12 2C11.6399 2 11.3306 2.25593 11.2632 2.60967C10.7844 5.12353 9.83969 7.03715 8.43842 8.43842C7.03715 9.83969 5.12353 10.7844 2.60967 11.2632C2.25593 11.3306 2 11.6399 2 12C2 12.3601 2.25593 12.6694 2.60967 12.7368C5.12353 13.2156 7.03715 14.1603 8.43842 15.5616C9.83969 16.9629 10.7844 18.8765 11.2632 21.3903C11.3306 21.7441 11.6399 22 12 22C12.3601 22 12.6694 21.7441 12.7368 21.3903C13.2156 18.8765 14.1603 16.9629 15.5616 15.5616C16.9629 14.1603 18.8765 13.2156 21.3903 12.7368C21.7441 12.6694 22 12.3601 22 12C22 11.6399 21.7441 11.3306 21.3903 11.2632C18.8765 10.7844 16.9629 9.83969 15.5616 8.43842C14.1603 7.03715 13.2156 5.12353 12.7368 2.60967Z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                      <p className="text-xs font-medium text-white/50 flex-1">
                        {cat.label}
                      </p>
                    </div>
                  <div className="space-y-1.5">
                    {cat.models.map((model) => {
                      const entryIndex = flatIndexByName.get(model.name) ?? 0;
                      const isContinuation = !query.trim() && entryIndex === 1;
                      return (
                        <ModelItem
                          key={`${catIdx}-${model.id}`}
                          model={model}
                          isSelected={selected === model.name}
                          onSelect={handleSelect}
                          isContinuation={isContinuation}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

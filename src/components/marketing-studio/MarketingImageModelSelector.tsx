"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { useListboxNav } from "@/hooks/useListboxNav";
import { getSharedModelIcon } from "@/lib/modelIconRegistry";

export interface MarketingImageModel {
  id: string;
  name: string;
  description: string;
  badges?: string[];
}

const FEATURED_MODELS: MarketingImageModel[] = [
  {
    id: "marketing-studio-image",
    name: "Marketing Studio Image",
    description: "Model built for marketing usecase",
  },
  {
    id: "higgsfield-soul-2",
    name: "Higgsfield Soul 2.0",
    description: "Next generation ultra-realistic fashion visuals",
  },
  {
    id: "higgsfield-soul-cinema",
    name: "Higgsfield Soul Cinema",
    description: "Cinema-grade visual creation",
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    description: "4K images with near-perfect text rendering",
  },
  {
    id: "seedream-5-pro",
    name: "Seedream 5.0 Pro",
    description: "Logically consistent images with intelligent visual reasoning",
  },
  {
    id: "seedream-5-lite",
    name: "Seedream 5.0 lite",
    description: "Intelligent visual reasoning",
    badges: ["UNLIMITED PAUSED"],
  },
  {
    id: "seedream-4-5",
    name: "Seedream 4.5",
    description: "ByteDance's next-gen 4K image-editing model",
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Google's flagship generation model",
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    description: "Pro quality at Flash speed",
  },
  {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    description: "Lightweight image generation at speed",
  },
  {
    id: "recraft-v4-1",
    name: "Recraft V4.1",
    description: "Photorealistic and expressive image generation",
  },
];

const ALL_MODELS: MarketingImageModel[] = [
  {
    id: "auto",
    name: "Auto",
    description: "The best model for any prompt, chosen for you",
  },
  {
    id: "higgsfield-soul",
    name: "Higgsfield Soul",
    description: "Ultra-realistic fashion visuals",
  },
  {
    id: "higgsfield-soul-2",
    name: "Higgsfield Soul 2.0",
    description: "Next generation ultra-realistic fashion visuals",
  },
  {
    id: "higgsfield-soul-cinema",
    name: "Higgsfield Soul Cinema",
    description: "Cinema-grade visual creation",
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    description: "4K images with near-perfect text rendering",
  },
  {
    id: "gpt-image-1-5",
    name: "GPT Image 1.5",
    description: "True-color precision rendering",
  },
  {
    id: "gpt-image",
    name: "GPT Image",
    description: "Versatile text-to-image AI",
  },
  {
    id: "marketing-studio-image",
    name: "Marketing Studio Image",
    description: "Model built for marketing usecase",
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Google's flagship generation model",
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    description: "Pro quality at Flash speed",
  },
  {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    description: "Lightweight image generation at speed",
  },
  {
    id: "nano-banana",
    name: "Nano Banana",
    description: "Google's standard generation model",
  },
  {
    id: "seedream-5-pro",
    name: "Seedream 5.0 Pro",
    description: "Logically consistent images with intelligent visual reasoning",
  },
  {
    id: "seedream-5-lite",
    name: "Seedream 5.0 lite",
    description: "Intelligent visual reasoning",
    badges: ["UNLIMITED PAUSED"],
  },
  {
    id: "seedream-4-5",
    name: "Seedream 4.5",
    description: "ByteDance's next-gen 4K image-editing model",
  },
  {
    id: "seedream-4-0",
    name: "Seedream 4.0",
    description: "ByteDance's advanced image editing model",
  },
  {
    id: "grok-imagine",
    name: "Grok Imagine",
    description: "Versatile image styles by xAI",
  },
  {
    id: "grok-imagine-2",
    name: "Grok Imagine 2.0",
    description: "High-resolution image generation by xAI",
  },
  {
    id: "recraft-v4-1",
    name: "Recraft V4.1",
    description: "Photorealistic and expressive image generation",
  },
  {
    id: "recraft-v4-1-utility",
    name: "Recraft V4.1 Utility",
    description: "Simple scenes with flat, even lighting",
  },
  {
    id: "z-image",
    name: "Z-Image",
    description: "Instant lifelike portraits",
  },
  {
    id: "kling-o1",
    name: "Kling O1",
    description: "Kling's Photorealistic Image Model",
  },
  {
    id: "flux-2-pro",
    name: "FLUX.2 Pro",
    description: "Speed-optimized detail",
    badges: ["UNLIMITED PAUSED"],
  },
  {
    id: "flux-2-flex",
    name: "FLUX.2 Flex",
    description: "Edit with accuracy",
  },
  {
    id: "flux-2-max",
    name: "FLUX.2 MAX",
    description: "Sharp text, maximum detail",
  },
  {
    id: "flux-kontext-max",
    name: "Flux Kontext Max",
    description: "Edit with accuracy",
  },
  {
    id: "multi-reference",
    name: "Multi Reference",
    description: "Multiple edits in one shot",
  },
  {
    id: "wan-2-2",
    name: "WAN 2.2",
    description: "High-fidelity cinematic visuals",
  },
];

const CATEGORY_SOURCES = [
  { label: "Featured models", models: FEATURED_MODELS },
  { label: "All models", models: ALL_MODELS },
];

function HiggsfieldGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M7.5 14.5c2.2 0 2.2-5 4.5-5s2.3 5 4.5 5M6.5 9.5c2.9 0 2.9 5 5.5 5s2.6-5 5.5-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function MarketingGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M5 17.5 16.5 6M8.5 6H18v9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M6 18h4v2H6zM14 4h4v4h-4z" fill="currentColor" opacity=".45" />
    </svg>
  );
}

function getMarketingModelIcon(name: string) {
  if (name.startsWith("Higgsfield Soul")) return HiggsfieldGlyph;
  if (name === "Marketing Studio Image") return MarketingGlyph;
  if (name === "Grok Imagine 2.0") return getSharedModelIcon("Grok Imagine");
  if (name === "FLUX.2 MAX") return getSharedModelIcon("FLUX.2 Max");
  return getSharedModelIcon(name);
}

function SectionIcon({ all }: { all: boolean }) {
  return all ? (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-white/40" aria-hidden>
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
    <Sparkles className="size-3.5 shrink-0 text-white/40" />
  );
}

function ModelBadge({ label }: { label: string }) {
  return (
    <span
      className={`ml-1.5 rounded px-1 py-px align-middle text-[8px] font-black uppercase italic leading-none ${
        label === "NEW"
          ? "bg-[#D7FF2F] text-black"
          : "bg-white/15 text-white/55"
      }`}
    >
      {label}
    </span>
  );
}

function MarketingModelRow({
  model,
  isSelected,
  isMarked,
  onSelect,
  optionRef,
  tabIndex,
}: {
  model: MarketingImageModel;
  isSelected: boolean;
  isMarked: boolean;
  onSelect: (name: string) => void;
  optionRef: (el: HTMLElement | null) => void;
  tabIndex: number;
}) {
  const Icon = getMarketingModelIcon(model.name);
  const marked = isMarked || isSelected;

  return (
    <button
      ref={optionRef}
      tabIndex={tabIndex}
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(model.name)}
      className={`group/model-row relative flex h-[56px] min-h-[56px] w-full cursor-pointer items-center rounded-[12px] border px-2.5 py-2 text-start outline-none transition-all duration-200 ease-out hover:translate-x-[2px] focus-visible:outline-none ${
        marked
          ? "border-[rgba(217,119,87,0.28)] bg-[rgba(217,119,87,0.10)] shadow-[0_4px_16px_rgba(0,0,0,0.34)]"
          : "border-white/[0.04] bg-[#101112] hover:border-white/[0.09] hover:bg-[#151719] focus:border-white/[0.09] focus:bg-[#151719]"
      }`}
    >
      {marked && (
        <span aria-hidden className="mr-2 h-7 w-[3px] shrink-0 rounded-full bg-[#D97757]" />
      )}
      <div
        className="mr-3 flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.04] bg-[#232529] text-white/65"
      >
        {Icon ? (
          <Icon className="size-4.5 text-white/80 group-hover/model-row:text-white" />
        ) : (
          <Sparkles className="size-4.5 text-white/70" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`truncate text-xs font-semibold ${marked ? "text-white" : "text-white/90"}`}>
          {model.name}
          {model.badges?.map((badge) => (
            <ModelBadge key={badge} label={badge} />
          ))}
        </span>
        <span className="truncate text-[10px] font-normal text-white/45 group-hover/model-row:text-white/60">
          {model.description}
        </span>
      </div>
      <div className="ml-1 flex size-5 shrink-0 items-center justify-center">
        {marked && <Check className="size-4 text-[#D97757]" />}
      </div>
    </button>
  );
}

export default function MarketingImageModelSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const selectedModel =
    [...FEATURED_MODELS, ...ALL_MODELS].find((model) => model.name === selected) ??
    FEATURED_MODELS[7];
  const SelectedIcon = getMarketingModelIcon(selectedModel.name);

  const categories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORY_SOURCES;
    return CATEGORY_SOURCES.map((category) => ({
      ...category,
      models: category.models.filter(
        (model) =>
          model.name.toLowerCase().includes(q) ||
          model.description.toLowerCase().includes(q),
      ),
    })).filter((category) => category.models.length > 0);
  }, [query]);

  const flatRows = useMemo(
    () => categories.flatMap((category) => category.models),
    [categories],
  );

  const handleSelect = (name: string) => {
    onSelect(name);
    setOpen(false);
    setQuery("");
  };

  const nav = useListboxNav({
    count: flatRows.length,
    selectedIndex: flatRows.findIndex((model) => model.name === selected),
    open,
    onSelect: (index) => {
      const model = flatRows[index];
      if (model) handleSelect(model.name);
    },
  });

  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [open]);

  const handlePanelKeyDown = (event: React.KeyboardEvent) => {
    const inSearch = event.target === searchInputRef.current;
    if (inSearch) {
      if (event.key === "ArrowUp") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        nav.moveTo(nav.activeIndex);
        return;
      }
      if (event.key === " ") return;
    } else {
      const printable =
        event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (printable || event.key === "Backspace") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setQuery((current) => (printable ? current + event.key : current.slice(0, -1)));
        return;
      }
    }
    nav.handleKeyDown(event);
  };

  let rowIndex = -1;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Image model: ${selected}`}
          className={`flex h-8 min-w-[156px] items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold text-white transition-all duration-200 focus:outline-none ${
            open
              ? "border-[#D97757] bg-[#181a1d]"
              : "border-white/[0.08] bg-[#101112] hover:border-[#D97757] hover:bg-[#181a1d]"
          }`}
        >
          {SelectedIcon ? (
            <SelectedIcon className="size-4 text-[#D97757]" />
          ) : (
            <Sparkles className="size-4 text-[#D97757]" />
          )}
          <span className="max-w-[124px] truncate text-white">{selectedModel.name}</span>
          <ChevronDown
            className={`size-3.5 transition-transform ${
              open ? "rotate-180 text-[#D97757]" : "text-neutral-400"
            }`}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          onKeyDown={handlePanelKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
          onEscapeKeyDown={nav.handleEscapeKeyDown}
          className="z-[100000] rounded-2xl border border-white/[0.08] bg-[rgba(19,21,23,0.92)] shadow-[0_22px_70px_rgba(0,0,0,0.55)] outline-none backdrop-blur-[28px] backdrop-saturate-[125%] transition-all duration-[170ms] ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=open]:zoom-in-95"
        >
          <div className="relative flex h-[520px] max-h-[var(--radix-popover-content-available-height,520px)] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl">
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-0 h-[42px] w-full rounded-[317px] bg-[rgba(217,119,87,0.13)] blur-[50px]"
            />
            <div className="relative z-10 p-2.5 pb-1">
              <div className="group/search flex h-[38px] items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#101112] px-3 transition-all duration-200 focus-within:border-[#D97757]/60 focus-within:bg-[#151719]">
                <Search className="size-4 shrink-0 text-white/40 transition-colors duration-200 group-focus-within/search:text-[#F19A72]" />
                <input
                  ref={searchInputRef}
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search models..."
                  aria-label="Search models"
                  className="w-full bg-transparent text-xs font-medium text-white outline-none placeholder:text-white/35"
                />
              </div>
            </div>

            <div
              ref={scrollContainerRef}
              className="hide-scrollbar relative z-10 min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-2.5"
              role="listbox"
              aria-label="Marketing Studio image models"
              onWheel={(event) => event.stopPropagation()}
            >
              {categories.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-white/40">
                  No models match &quot;{query}&quot;.
                </p>
              )}

              {categories.map((category, categoryIndex) => {
                const isAll = category.label.toLowerCase().includes("all");
                return (
                  <div key={`${category.label}-${categoryIndex}`} className="mb-3">
                    <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-xs font-medium text-white/40">
                      <SectionIcon all={isAll} />
                      <span>{category.label}</span>
                    </div>
                    <div className="space-y-1.5">
                      {category.models.map((model) => {
                        rowIndex += 1;
                        const optionProps = nav.getOptionProps(rowIndex);
                        return (
                          <MarketingModelRow
                            key={`${categoryIndex}-${model.id}`}
                            model={model}
                            isSelected={selected === model.name}
                            isMarked={nav.activeIndex === rowIndex}
                            onSelect={handleSelect}
                            optionRef={optionProps.ref}
                            tabIndex={optionProps.tabIndex}
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
